"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { openPicker } from "@/components/custom-range";
import { Icon } from "@/components/icons";
import type { ReportEvent } from "@/app/api/reportes/route";
import type { ReportStep } from "@/lib/report/generate";

// Resta días a una fecha YYYY-MM-DD sin pasar por la zona horaria local.
const shift = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
};

// Mes calendario anterior al de hoy: 1 al último día.
function previousMonth(today: string) {
  const [y, m] = today.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10);
  return [start, end] as const;
}

const STEPS: { step: ReportStep; label: string }[] = [
  { step: "datos", label: "Leyendo Meta, CRM y Clarity del período" },
  { step: "claude", label: "Claude analiza los números" },
  { step: "html", label: "Armando y guardando el reporte" },
];

type Run =
  | { state: "running"; step: ReportStep | null; thinking: string }
  | { state: "done"; id: string; warning: string | null; thinking: string }
  | { state: "error"; message: string; thinking: string };

export function ReportForm({ clientSlug, today, oldest }: { clientSlug: string; today: string; oldest: string }) {
  const [since, setSince] = useState(shift(today, 30));
  const [until, setUntil] = useState(today);
  const [run, setRun] = useState<Run | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const thinkingBox = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const running = run?.state === "running";

  const presets = [
    { label: "Últimos 30 días", range: [shift(today, 30), today] as const },
    { label: "Mes anterior", range: previousMonth(today) },
  ].filter((p) => p.range[0] >= oldest);

  // El razonamiento llega de a pedazos: se sigue el final, como un chat.
  useEffect(() => {
    const box = thinkingBox.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [run?.thinking]);

  async function generate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRun({ state: "running", step: null, thinking: "" });
    dialog.current?.showModal();

    try {
      const res = await fetch("/api/reportes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client: clientSlug, since, until }),
      });
      if (!res.ok || !res.body) throw new Error("No se pudo iniciar la generación del reporte.");

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
          const e = JSON.parse(line.slice(6)) as ReportEvent;
          setRun((prev) => {
            const thinking = prev?.thinking ?? "";
            if (e.type === "step") return { state: "running", step: e.step, thinking };
            if (e.type === "thinking") return prev?.state === "running" ? { ...prev, thinking: thinking + e.text } : prev;
            if (e.type === "done") return { state: "done", id: e.id, warning: e.warning, thinking };
            return { state: "error", message: e.message, thinking };
          });
          if (e.type === "done") router.refresh();
        }
      }
      // Si el stream se cortó sin decir cómo terminó (p. ej. un timeout).
      setRun((prev) =>
        prev?.state === "running" ? { state: "error", message: "La generación se cortó antes de terminar.", thinking: prev.thinking } : prev,
      );
    } catch (e) {
      setRun({ state: "error", message: e instanceof Error ? e.message : "No se pudo generar el reporte.", thinking: "" });
    }
  }

  const current = run?.state === "running" ? STEPS.findIndex((s) => s.step === run.step) : STEPS.length;

  return (
    <>
      <form onSubmit={generate} className="report-form">
        <div className="report-presets">
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              className={`chip${since === p.range[0] && until === p.range[1] ? " on" : ""}`}
              onClick={() => {
                setSince(p.range[0]);
                setUntil(p.range[1]);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="report-dates">
          <label>
            <span>Desde</span>
            <input type="date" value={since} min={oldest} max={until} onChange={(e) => setSince(e.target.value)} onClick={openPicker} required />
          </label>
          <label>
            <span>Hasta</span>
            <input type="date" value={until} min={since} max={today} onChange={(e) => setUntil(e.target.value)} onClick={openPicker} required />
          </label>
        </div>

        <p className="report-help">
          Toma Meta, CRM y Clarity del período y Claude escribe la lectura y los próximos pasos. Tarda alrededor de un minuto.
        </p>

        <div>
          <button type="submit" className="connect-btn" disabled={running}>
            <Icon name="sparkles" size={17} />
            Generar reporte
          </button>
        </div>
      </form>

      {/* <dialog> nativo: capa superior, Escape y foco atrapado. Mientras genera no se cierra. */}
      <dialog
        ref={dialog}
        className="modal"
        aria-labelledby="report-run-title"
        onCancel={(e) => {
          if (running) e.preventDefault();
        }}
      >
        <div className="modal-card report-run">
          <div className={`modal-ico report-run-ico${run?.state === "error" ? " err" : ""}`}>
            <Icon name={run?.state === "done" ? "check" : run?.state === "error" ? "close" : "sparkles"} />
          </div>
          <h2 id="report-run-title">
            {run?.state === "done" ? "Reporte listo" : run?.state === "error" ? "No se pudo generar" : "Generando el reporte"}
          </h2>

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

          {(run?.thinking || (run?.state === "running" && run.step === "claude")) && (
            <div className="report-thinking">
              <div className="report-thinking-head">
                {running && <i />}
                {running ? "Claude está pensando" : "Cómo lo pensó Claude"}
              </div>
              <div ref={thinkingBox} className="report-thinking-text">
                {run?.thinking || "…"}
              </div>
            </div>
          )}

          {run?.state === "error" && <p className="form-error">{run.message}</p>}
          {run?.state === "done" && run.warning && <p className="form-error">{run.warning}</p>}

          {run?.state === "done" ? (
            <div className="modal-actions">
              <a className="btn-primary report-btn" href={`/api/reportes/${run.id}`} target="_blank" rel="noopener">
                <Icon name="eye" size={17} />
                Ver reporte
              </a>
              <a className="btn-secondary report-btn" href={`/api/reportes/${run.id}?descargar=1`}>
                <Icon name="download" size={17} />
                Descargar
              </a>
            </div>
          ) : null}
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
