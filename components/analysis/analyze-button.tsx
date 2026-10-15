"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import type { AnalysisEvent } from "@/app/api/analisis/route";
import type { AnalysisStep } from "@/lib/analysis/generate";
import type { Platform } from "@/lib/analysis/shared";

const STEPS: { step: AnalysisStep; label: string }[] = [
  { step: "datos", label: "Leyendo la configuración y el rendimiento de la cuenta" },
  { step: "claude", label: "Claude revisa la cuenta y arma las recomendaciones" },
  { step: "guardar", label: "Guardando el análisis" },
];

type Run =
  | { state: "running"; step: AnalysisStep | null }
  | { state: "done"; dropped: number }
  | { state: "error"; message: string };

// "Analizar plataforma" (solo equipo): lanza el análisis del período elegido y
// muestra en un modal los tres pasos (sin el razonamiento de Claude). `period` es la query del
// período (mes=… / desde=…&hasta=…), la misma que lleva la solapa.
export function AnalyzeButton({
  clientSlug,
  platform,
  period,
  periodLabel,
  resultHref,
}: {
  clientSlug: string;
  platform: Platform;
  period: string;
  periodLabel: string;
  resultHref: string;
}) {
  const [run, setRun] = useState<Run | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const running = run?.state === "running";

  async function analyze() {
    setRun({ state: "running", step: null });
    dialog.current?.showModal();

    try {
      const res = await fetch("/api/analisis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client: clientSlug, platform, ...Object.fromEntries(new URLSearchParams(period)) }),
      });
      if (!res.ok || !res.body) throw new Error("No se pudo iniciar el análisis.");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const line = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const e = JSON.parse(line.slice(6)) as AnalysisEvent;
          if (e.type === "step") setRun({ state: "running", step: e.step });
          else if (e.type === "done") setRun({ state: "done", dropped: e.dropped });
          else setRun({ state: "error", message: e.message });
          // Se cambió desde una ruta /api: sin refresh, la pantalla podría mostrar
          // el análisis anterior al volver (staleTimes).
          if (e.type === "done") router.refresh();
        }
      }
      setRun((prev) =>
        prev?.state === "running" ? { state: "error", message: "El análisis se cortó antes de terminar." } : prev,
      );
    } catch (e) {
      setRun({ state: "error", message: e instanceof Error ? e.message : "No se pudo generar el análisis." });
    }
  }

  const current = run?.state === "running" ? STEPS.findIndex((s) => s.step === run.step) : STEPS.length;

  return (
    <>
      <button type="button" className="connect-btn analyze-btn" onClick={analyze} disabled={running}>
        <Icon name="sparkles" size={16} />
        Analizar plataforma
      </button>

      <dialog
        ref={dialog}
        className="modal"
        aria-labelledby="analysis-run-title"
        onCancel={(e) => {
          if (running) e.preventDefault();
        }}
      >
        <div className="modal-card report-run">
          <div className={`modal-ico report-run-ico${run?.state === "error" ? " err" : ""}`}>
            <Icon name={run?.state === "done" ? "check" : run?.state === "error" ? "close" : "sparkles"} />
          </div>
          <h2 id="analysis-run-title">
            {run?.state === "done" ? "Análisis listo" : run?.state === "error" ? "No se pudo analizar" : "Analizando la plataforma"}
          </h2>
          <p className="analysis-run-period">Período: {periodLabel}</p>

          <ol className="report-steps">
            {STEPS.map((s, i) => {
              const state = run?.state === "error" ? (i < current ? "ok" : "") : i < current ? "ok" : i === current ? "now" : "";
              return (
                <li key={s.step} className={state}>
                  <span className="report-step-dot">{state === "ok" ? <Icon name="check" size={12} strokeWidth={2.6} /> : null}</span>
                  {s.label}
                </li>
              );
            })}
          </ol>

          {run?.state === "error" && <p className="form-error">{run.message}</p>}
          {run?.state === "done" && run.dropped > 0 && (
            <p className="hint-text">
              Se descartaron {run.dropped} recomendación{run.dropped === 1 ? "" : "es"} que apuntaba{run.dropped === 1 ? "" : "n"} a algo
              que no existe en la cuenta.
            </p>
          )}

          {run?.state === "done" && (
            <div className="modal-actions">
              <Link className="btn-primary report-btn" href={resultHref} onClick={() => dialog.current?.close()}>
                <Icon name="eye" size={17} />
                Ver recomendaciones
              </Link>
            </div>
          )}
          {!running && (
            <button type="button" className="report-close" onClick={() => dialog.current?.close()}>
              Cerrar
            </button>
          )}
        </div>
      </dialog>
    </>
  );
}
