"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { REPORT_FILE_MAX_BYTES, REPORTS_BUCKET, reportFileType } from "@/lib/report/files";
import type { ReportMetrics } from "@/lib/report/metrics";
import { createClient } from "@/lib/supabase/client";
import { createReportUpload, discardReportUpload, saveManualReport } from "./actions";
import { MetricsEditor } from "./metrics-editor";

type Read = { path: string; fileName: string; since: string; until: string; metrics: ReportMetrics };

// Carga de un reporte hecho fuera de la intranet (PDF o HTML): se sube a Storage,
// Claude saca sus números y el equipo los revisa antes de guardar. Así queda en
// el historial y sirve para un reporte comparativo.
export function ManualReport({ clientSlug }: { clientSlug: string }) {
  const input = useRef<HTMLInputElement>(null);
  const reading = useRef<HTMLDialogElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [read, setRead] = useState<Read | null>(null);
  // Guardado: al cerrar el editor no se borra el archivo. Ref y no estado: el
  // modal se cierra antes de que React vuelva a dibujar.
  const saved = useRef(false);
  const [dragging, setDragging] = useState(false);
  const router = useRouter();

  // Elegido con el selector o soltado en el recuadro: se valida al toque.
  const choose = (picked: File | null) => {
    setError(null);
    if (picked && !reportFileType(picked.name, picked.type)) {
      setFile(null);
      return setError("Subí el reporte en PDF o HTML.");
    }
    if (picked && picked.size > REPORT_FILE_MAX_BYTES) {
      setFile(null);
      return setError("El archivo no puede pesar más de 20 MB.");
    }
    setFile(picked);
  };
  const clear = () => {
    setFile(null);
    if (input.current) input.current.value = "";
  };
  const size = (bytes: number) =>
    bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

  async function upload() {
    if (!file) return;
    const type = reportFileType(file.name, file.type);
    if (!type) return setError("Subí el reporte en PDF o HTML.");
    if (file.size > REPORT_FILE_MAX_BYTES) return setError("El archivo no puede pesar más de 20 MB.");

    setError(null);
    setBusy(true);
    reading.current?.showModal();
    let path: string | null = null;
    try {
      const signed = await createReportUpload(clientSlug, { name: file.name, type: file.type, size: file.size });
      if (!signed.ok) throw new Error(signed.error);
      path = signed.path;
      const { error: uploadError } = await createClient()
        .storage.from(REPORTS_BUCKET)
        .uploadToSignedUrl(signed.path, signed.token, file, { contentType: type });
      if (uploadError) throw new Error("No se pudo subir el archivo.");

      const res = await fetch("/api/reportes/importar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client: clientSlug, path }),
      });
      const data = (await res.json().catch(() => null)) as
        | { since: string | null; until: string | null; metrics: ReportMetrics; error?: undefined }
        | { error: string }
        | null;
      if (!res.ok || !data || "error" in data) throw new Error(data && "error" in data ? data.error : "Claude no pudo leer el reporte.");
      saved.current = false;
      setRead({ path, fileName: file.name, since: data.since ?? "", until: data.until ?? "", metrics: data.metrics });
    } catch (e) {
      if (path) await discardReportUpload(clientSlug, path);
      setError(e instanceof Error ? e.message : "No se pudo leer el reporte.");
    } finally {
      reading.current?.close();
      setBusy(false);
    }
  }

  return (
    <>
      <div className="report-form">
        {/* Recuadro para soltar el archivo o hacer clic; el input queda oculto adentro. */}
        <label
          className={`file-drop${dragging ? " over" : ""}${file ? " has-file" : ""}${busy ? " busy" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            if (!busy) setDragging(true);
          }}
          onDragLeave={(e) => {
            // Pasar por encima del texto o del ícono también dispara dragleave.
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!busy) choose(e.dataTransfer.files?.[0] ?? null);
          }}
        >
          <input
            ref={input}
            type="file"
            className="file-drop-input"
            accept="application/pdf,.pdf,text/html,.html,.htm"
            onChange={(e) => choose(e.target.files?.[0] ?? null)}
            disabled={busy}
          />
          <span className="file-drop-ico">
            <Icon name={file ? "doc" : "upload"} size={22} />
          </span>
          {file ? (
            <span className="file-drop-text">
              <b>{file.name}</b>
              <span>{size(file.size)} · hacé clic para cambiarlo</span>
            </span>
          ) : (
            <span className="file-drop-text">
              <b>Arrastrá el reporte acá o hacé clic para elegirlo</b>
              <span>PDF o HTML, hasta 20 MB</span>
            </span>
          )}
          {file && !busy && (
            <button
              type="button"
              className="report-act danger file-drop-clear"
              onClick={(e) => {
                e.preventDefault();
                clear();
              }}
            >
              <Icon name="close" size={14} />
              <span>Quitar</span>
            </button>
          )}
        </label>
        <p className="report-help">
          Un reporte hecho fuera de la intranet, en PDF o HTML (hasta 20 MB). Claude saca sus números y los revisás antes de
          guardar: quedan en el historial para compararlos en un reporte comparativo.
        </p>
        {error && <p className="form-error">{error}</p>}
        <div>
          <button type="button" className="connect-btn" disabled={!file || busy} onClick={upload}>
            <Icon name="upload" size={17} />
            {busy ? "Leyendo…" : "Subir y leer"}
          </button>
        </div>
      </div>

      <dialog ref={reading} className="modal" aria-labelledby="manual-reading-title" onCancel={(e) => e.preventDefault()}>
        <div className="modal-card report-run">
          <div className="modal-ico report-run-ico">
            <Icon name="sparkles" />
          </div>
          <h2 id="manual-reading-title">Leyendo el reporte</h2>
          <p>Claude está sacando los números del archivo. Puede tardar un minuto.</p>
        </div>
      </dialog>

      {read && (
        <MetricsEditor
          title="Revisá los números del reporte"
          lead={
            <>
              Claude leyó <b>{read.fileName}</b>. Corregí lo que haga falta y completá el período: estos números son los que
              va a usar un reporte comparativo. Lo que quede vacío no se compara.
            </>
          }
          since={read.since}
          until={read.until}
          metrics={read.metrics}
          periodEditable
          saveLabel="Guardar en el historial"
          onSave={async (values) => {
            const result = await saveManualReport(clientSlug, { path: read.path, fileName: read.fileName, ...values });
            if (result.ok) {
              saved.current = true;
              setFile(null);
              if (input.current) input.current.value = "";
              router.refresh();
            }
            return result;
          }}
          onClose={() => {
            if (!saved.current) void discardReportUpload(clientSlug, read.path);
            setRead(null);
          }}
        />
      )}
    </>
  );
}
