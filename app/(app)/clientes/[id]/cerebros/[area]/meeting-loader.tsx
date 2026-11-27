"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import {
  type MeetingDraft,
  type RecordedMeeting,
  MAX_MEETING_FILE,
  MEETING_ACCEPT,
  MIN_TRANSCRIPT,
} from "@/lib/brain-meetings-shared";
import { listRecordedMeetings } from "../actions";
import { meetingFileText } from "./extract-text";
import { MeetingReview } from "./meeting-review";

// Cargar una reunión a un cerebro: subir el archivo (export de Claude meetings,
// transcripción, Word o PDF), pegar el texto, o elegirla del calendario propio
// (los documentos que Meet adjunta al evento). Claude la interpreta y se revisa
// en MeetingReview antes de guardar.

type Mode = "archivo" | "texto" | "meet";

const dateLabel = (iso: string) =>
  new Date(iso.length === 10 ? `${iso}T12:00:00-03:00` : iso).toLocaleDateString("es-AR", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "America/Argentina/Buenos_Aires",
  });
const isoDay = (iso: string) =>
  iso.length === 10 ? iso : new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
const DOC_LABEL = { transcripcion: "Transcripción", gemini: "Notas de Gemini", documento: "Documento" } as const;

export function MeetingLoader({ area, areaName }: { area: string; areaName: string }) {
  const [mode, setMode] = useState<Mode>("archivo");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<MeetingDraft | null>(null);

  const interpret = async (payload: Record<string, unknown>, label: string) => {
    setBusy(label);
    setError(null);
    try {
      const res = await fetch("/api/cerebros/interpretar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ area, ...payload }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.draft) throw new Error(body?.error ?? "No se pudo interpretar la reunión.");
      setDraft(body.draft as MeetingDraft);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo interpretar la reunión.");
      return false;
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="brain-meeting">
      <div className="brain-seg brain-seg-sub" role="tablist" aria-label="Cómo cargar la reunión">
        {(
          [
            ["archivo", "Archivo"],
            ["texto", "Pegar texto"],
            ["meet", "De mi calendario"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={mode === key}
            className={mode === key ? "on" : ""}
            disabled={!!busy}
            onClick={() => {
              setMode(key);
              setError(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {busy ? (
        <div className="brain-working" role="status">
          <span className="brain-working-dot" aria-hidden />
          <div>
            <b>Claude está interpretando {busy}…</b>
            <span>Lee la reunión entera y saca lo que le sirve a {areaName}. Puede tardar un minuto.</span>
          </div>
        </div>
      ) : mode === "archivo" ? (
        <FileMode onText={(text, fileName) => interpret({ source: "archivo", text, fileName }, `“${fileName}”`)} onError={setError} />
      ) : mode === "texto" ? (
        <PasteMode onText={(text, title) => interpret({ source: "texto", text, title }, "la reunión")} />
      ) : (
        <MeetMode
          area={area}
          onPick={(m, docs) =>
            interpret(
              { source: "calendario", docs, title: m.title, date: isoDay(m.start), attendees: m.attendees },
              `“${m.title}”`,
            )
          }
        />
      )}

      {error && <p className="form-error brain-meeting-error">{error}</p>}

      {draft && <MeetingReview draft={draft} areaName={areaName} onClose={() => setDraft(null)} />}
    </div>
  );
}

function FileMode({ onText, onError }: { onText: (text: string, fileName: string) => void; onError: (e: string | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [reading, setReading] = useState(false);

  const take = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    onError(null);
    if (file.size > MAX_MEETING_FILE) return onError("El archivo pasa los 20 MB.");
    setReading(true);
    try {
      const text = (await meetingFileText(file)).trim();
      if (text.length < MIN_TRANSCRIPT) return onError("El archivo casi no tiene texto. Si es un PDF escaneado, exportalo de nuevo como .md o .docx.");
      onText(text, file.name);
    } catch (e) {
      onError(e instanceof Error ? e.message : "No se pudo leer el archivo.");
    } finally {
      setReading(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <button
      type="button"
      className={`brain-drop${drag ? " drag" : ""}`}
      disabled={reading}
      onClick={() => input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        take(e.dataTransfer.files);
      }}
    >
      <span className="brain-drop-ico">
        <Icon name="upload" size={22} />
      </span>
      <b>{reading ? "Leyendo el archivo…" : "Arrastrá la reunión o hacé clic"}</b>
      <span>Export de Claude meetings (.md), transcripción (.txt, .vtt), Word o PDF</span>
      <input ref={input} type="file" accept={MEETING_ACCEPT} hidden onChange={(e) => take(e.target.files)} />
    </button>
  );
}

function PasteMode({ onText }: { onText: (text: string, title: string) => void }) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const ready = text.trim().length >= MIN_TRANSCRIPT;
  return (
    <div className="brain-note">
      <input className="input" placeholder="Nombre de la reunión (opcional)" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea
        className="input"
        rows={7}
        placeholder="Pegá la transcripción o las notas de la reunión…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button type="button" className="act-btn" disabled={!ready} onClick={() => onText(text, title.trim())}>
        <Icon name="sparkles" size={15} />
        Interpretar
      </button>
    </div>
  );
}

function MeetMode({ area, onPick }: { area: string; onPick: (m: RecordedMeeting, docs: { id: string; title: string }[]) => void }) {
  const [state, setState] = useState<{ meetings: RecordedMeeting[] } | { error: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let alive = true;
    listRecordedMeetings(area).then((r) => {
      if (alive) setState(r.ok ? { meetings: r.meetings } : { error: r.error });
    });
    return () => {
      alive = false;
    };
  }, [area]);

  if (!state) return <p className="brain-meet-empty">Buscando reuniones grabadas en tu calendario…</p>;
  if ("error" in state) return <p className="form-error">{state.error}</p>;
  if (!state.meetings.length) {
    return (
      <p className="brain-meet-empty">
        No hay reuniones de los últimos 60 días con transcripción o notas de Gemini en tu calendario. Si la grabó otra persona,
        pedile que te comparta los documentos o cargá el archivo.
      </p>
    );
  }

  return (
    <ul className="brain-meet-list">
      {state.meetings.map((m) => {
        const isOpen = open === m.key;
        const docs = m.docs.filter((d) => chosen[`${m.key}|${d.id}`] ?? true);
        return (
          <li key={m.key} className={isOpen ? "open" : ""}>
            <button type="button" className="brain-meet-row" onClick={() => setOpen(isOpen ? null : m.key)} aria-expanded={isOpen}>
              <span className="brain-meet-date">{dateLabel(m.start)}</span>
              <span className="brain-meet-title">{m.title}</span>
              {m.loaded && <span className="brain-tag ok">Ya cargada</span>}
              <Icon name="chevron" size={14} />
            </button>
            {isOpen && (
              <div className="brain-meet-body">
                {m.attendees.length > 0 && <p className="brain-meet-people">{m.attendees.join(", ")}</p>}
                {m.docs.map((d) => {
                  const k = `${m.key}|${d.id}`;
                  return (
                    <label key={d.id} className="brain-meet-doc">
                      <input type="checkbox" checked={chosen[k] ?? true} onChange={(e) => setChosen((c) => ({ ...c, [k]: e.target.checked }))} />
                      <Icon name="doc" size={14} />
                      <span>{d.title}</span>
                      <em>{DOC_LABEL[d.kind]}</em>
                    </label>
                  );
                })}
                <button type="button" className="act-btn" disabled={!docs.length} onClick={() => onPick(m, docs.map((d) => ({ id: d.id, title: d.title })))}>
                  <Icon name="sparkles" size={15} />
                  {m.loaded ? "Interpretar de nuevo" : "Interpretar"}
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
