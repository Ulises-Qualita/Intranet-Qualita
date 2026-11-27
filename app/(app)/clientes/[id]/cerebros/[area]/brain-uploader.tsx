"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { BRAIN_ACCEPT } from "@/lib/brains";
import { MeetingLoader } from "./meeting-loader";

// Carga manual de información a un cerebro: reuniones (meeting-loader.tsx, ya
// se guardan), archivos o una nota escrita. Archivos y notas siguen siendo solo
// interfaz: lo elegido queda en la pantalla como "Sin guardar".

type Pending = { id: number; name: string; size: string; kind: "archivo" | "nota" };

const sizeText = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;

let nextId = 1;

export function BrainUploader({ area, areaName }: { area: string; areaName: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [mode, setMode] = useState<"reunion" | "archivos" | "nota">("reunion");
  const [note, setNote] = useState({ title: "", body: "" });
  const [pending, setPending] = useState<Pending[]>([]);

  const addFiles = (files: FileList | null) => {
    if (!files?.length) return;
    setPending((list) => [...list, ...[...files].map((f) => ({ id: nextId++, name: f.name, size: sizeText(f.size), kind: "archivo" as const }))]);
  };

  const addNote = () => {
    if (!note.body.trim()) return;
    setPending((list) => [...list, { id: nextId++, name: note.title.trim() || "Nota sin título", size: `${note.body.trim().split(/\s+/).length} palabras`, kind: "nota" }]);
    setNote({ title: "", body: "" });
  };

  return (
    <div className="card brain-upload">
      <div className="brain-upload-head">
        <h3>Cargar información</h3>
        <div className="brain-seg" role="tablist" aria-label="Qué cargar">
          <button type="button" role="tab" aria-selected={mode === "reunion"} className={mode === "reunion" ? "on" : ""} onClick={() => setMode("reunion")}>
            Reunión
          </button>
          <button type="button" role="tab" aria-selected={mode === "archivos"} className={mode === "archivos" ? "on" : ""} onClick={() => setMode("archivos")}>
            Archivos
          </button>
          <button type="button" role="tab" aria-selected={mode === "nota"} className={mode === "nota" ? "on" : ""} onClick={() => setMode("nota")}>
            Nota
          </button>
        </div>
      </div>

      {mode === "reunion" ? (
        <MeetingLoader area={area} areaName={areaName} />
      ) : mode === "archivos" ? (
        <button
          type="button"
          className={`brain-drop${drag ? " drag" : ""}`}
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            addFiles(e.dataTransfer.files);
          }}
        >
          <span className="brain-drop-ico">
            <Icon name="upload" size={22} />
          </span>
          <b>Arrastrá archivos o hacé clic</b>
          <span>PDF, Markdown, Word, texto, CSV o PowerPoint</span>
          <input ref={input} type="file" multiple accept={BRAIN_ACCEPT} hidden onChange={(e) => addFiles(e.target.files)} />
        </button>
      ) : (
        <div className="brain-note">
          <input
            className="input"
            placeholder="Título (opcional)"
            value={note.title}
            onChange={(e) => setNote((n) => ({ ...n, title: e.target.value }))}
          />
          <textarea
            className="input"
            rows={6}
            placeholder={`Criterio, procesos o aprendizajes de ${areaName}…`}
            value={note.body}
            onChange={(e) => setNote((n) => ({ ...n, body: e.target.value }))}
          />
          <button type="button" className="act-btn" onClick={addNote} disabled={!note.body.trim()}>
            <Icon name="plus" size={15} />
            Agregar nota
          </button>
        </div>
      )}

      {mode !== "reunion" && pending.length > 0 && (
        <ul className="brain-pending">
          {pending.map((p) => (
            <li key={p.id}>
              <Icon name={p.kind === "nota" ? "doc" : "file"} size={16} />
              <span className="brain-pending-name">{p.name}</span>
              <span className="brain-pending-size">{p.size}</span>
              <span className="brain-tag">Sin guardar</span>
              <button type="button" className="brain-pending-x" aria-label={`Quitar ${p.name}`} onClick={() => setPending((l) => l.filter((x) => x.id !== p.id))}>
                <Icon name="close" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {mode !== "reunion" && (
        <p className="brain-upload-foot">
          <Icon name="clock" size={14} />
          La carga de archivos y notas todavía no está conectada: lo que agregues acá no se guarda.
        </p>
      )}
    </div>
  );
}
