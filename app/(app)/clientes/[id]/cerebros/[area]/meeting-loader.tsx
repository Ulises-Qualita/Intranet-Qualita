"use client";

import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/icons";
import {
  type CalendarDoc,
  type MeetingDraft,
  type NotionMeeting,
  type RecordedMeeting,
  MAX_MEETING_FILE,
  MEETING_ACCEPT,
  MIN_TRANSCRIPT,
} from "@/lib/brain-meetings-shared";
import { listNotionMeetingsAction, listRecordedMeetings } from "../actions";
import { meetingFileText } from "./extract-text";
import { MeetingReview } from "./meeting-review";

// Cargar una reunión a un cerebro: subir el archivo (export de Claude meetings,
// transcripción, Word o PDF), pegar el texto, elegirla del calendario propio (un
// documento de Meet adjunto al evento) o de la database de Reuniones de Notion
// (su transcripción). Se elige la reunión entera, no sus partes (pedido). Claude
// la interpreta y se revisa en MeetingReview antes de guardar.

type Mode = "archivo" | "texto" | "meet" | "notion";

const MODES: { key: Mode; label: string; icon: IconName }[] = [
  { key: "archivo", label: "Archivo", icon: "upload" },
  { key: "texto", label: "Pegar texto", icon: "pen" },
  { key: "meet", label: "Calendario", icon: "calendar" },
  { key: "notion", label: "Notion", icon: "grid" },
];

const TZ = "America/Argentina/Buenos_Aires";
const toDate = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00-03:00` : iso);
const isoDay = (iso: string) => (iso.length === 10 ? iso : toDate(iso).toLocaleDateString("en-CA", { timeZone: TZ }));
const DOC_LABEL = { transcripcion: "Transcripción", gemini: "Notas de Gemini", documento: "Documento" } as const;

// De los documentos que Meet adjunta, uno solo: la transcripción; si no hay, las
// notas de Gemini; si no, el primero.
const DOC_RANK: Record<CalendarDoc["kind"], number> = { transcripcion: 0, gemini: 1, documento: 2 };
const bestDoc = (docs: CalendarDoc[]) => [...docs].sort((a, b) => DOC_RANK[a.kind] - DOC_RANK[b.kind])[0];

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
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo interpretar la reunión.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="brain-meeting">
      <div className="brain-sources" role="tablist" aria-label="De dónde cargar la reunión">
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            role="tab"
            aria-selected={mode === m.key}
            className={`brain-source${mode === m.key ? " on" : ""}`}
            disabled={!!busy}
            onClick={() => {
              setMode(m.key);
              setError(null);
            }}
          >
            <Icon name={m.icon} size={16} />
            <span>{m.label}</span>
          </button>
        ))}
      </div>

      {busy ? (
        <div className="brain-working" role="status">
          <BrainSpinner />
          <div>
            <b>Claude está interpretando {busy}</b>
            <span>Lee la reunión entera y saca los criterios de {areaName}. Puede tardar un minuto.</span>
          </div>
        </div>
      ) : mode === "archivo" ? (
        <FileMode onText={(text, fileName) => interpret({ source: "archivo", text, fileName }, `“${fileName}”`)} onError={setError} />
      ) : mode === "texto" ? (
        <PasteMode onText={(text, title) => interpret({ source: "texto", text, title }, "la reunión")} />
      ) : mode === "notion" ? (
        <NotionMode area={area} onPick={(m) => interpret({ source: "notion", pageId: m.id }, `“${m.title}”`)} />
      ) : (
        <MeetMode
          area={area}
          onPick={(m) => {
            const doc = bestDoc(m.docs);
            interpret(
              {
                source: "calendario",
                docs: [{ id: doc.id, title: doc.title }],
                title: m.title,
                date: isoDay(m.start),
                attendees: m.attendees,
              },
              `“${m.title}”`,
            );
          }}
        />
      )}

      {error && <p className="form-error brain-meeting-error">{error}</p>}

      {draft && <MeetingReview draft={draft} areaName={areaName} onClose={() => setDraft(null)} />}
    </div>
  );
}

// Anillo con el degradado de marca que gira, con un punto que late al medio.
function BrainSpinner({ small = false }: { small?: boolean }) {
  return <span className={`brain-spinner${small ? " sm" : ""}`} aria-hidden />;
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
      <span className="brain-drop-ico">{reading ? <BrainSpinner small /> : <Icon name="upload" size={22} />}</span>
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

// ---------- Lista de reuniones (calendario y Notion) ----------

type PickItem = {
  key: string;
  date: string | null;
  title: string;
  meta: string;
  // De dónde sale el texto (en el calendario, qué documento se va a leer).
  note: string | null;
  loaded: boolean;
};

type ListState<T> = { items: T[] } | { error: string } | null;

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function useList<T>(load: () => Promise<{ ok: true; items: T[] } | { ok: false; error: string }>, deps: unknown[]) {
  const [state, setState] = useState<ListState<T>>(null);
  useEffect(() => {
    let alive = true;
    setState(null);
    load().then((r) => {
      if (alive) setState(r.ok ? { items: r.items } : { error: r.error });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

function MeetMode({ area, onPick }: { area: string; onPick: (m: RecordedMeeting) => void }) {
  const state = useList(async () => {
    const r = await listRecordedMeetings(area);
    return r.ok ? { ok: true as const, items: r.meetings } : r;
  }, [area]);
  return (
    <MeetingPicker
      state={state}
      loadingText="Buscando reuniones grabadas en tu calendario"
      empty="No hay reuniones de los últimos 60 días con transcripción o notas de Gemini en tu calendario. Si la grabó otra persona, pedile que te comparta los documentos o cargá el archivo."
      toItem={(m) => ({
        key: m.key,
        date: m.start,
        title: m.title,
        meta: m.attendees.join(", "),
        note: DOC_LABEL[bestDoc(m.docs).kind],
        loaded: m.loaded,
      })}
      onPick={onPick}
    />
  );
}

function NotionMode({ area, onPick }: { area: string; onPick: (m: NotionMeeting) => void }) {
  const state = useList(async () => {
    const r = await listNotionMeetingsAction(area);
    return r.ok ? { ok: true as const, items: r.meetings } : r;
  }, [area]);
  return (
    <MeetingPicker
      state={state}
      loadingText="Buscando reuniones en Notion"
      empty="No hay reuniones de los últimos 60 días en la database de Reuniones de Notion."
      toItem={(m) => ({
        key: m.id,
        date: m.date,
        title: m.title,
        meta: [m.category, m.participants.join(", ")].filter(Boolean).join(" · "),
        note: null,
        loaded: m.loaded,
      })}
      onPick={onPick}
    />
  );
}

function MeetingPicker<T>({
  state,
  loadingText,
  empty,
  toItem,
  onPick,
}: {
  state: ListState<T>;
  loadingText: string;
  empty: string;
  toItem: (m: T) => PickItem;
  onPick: (m: T) => void;
}) {
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);

  if (!state) {
    return (
      <div className="brain-list-loading" role="status" aria-live="polite">
        <div className="brain-list-status">
          <BrainSpinner small />
          <span>
            {loadingText}
            <i className="brain-dots" aria-hidden>
              <b />
              <b />
              <b />
            </i>
          </span>
        </div>
        <ul className="brain-skel" aria-hidden>
          {[0, 1, 2, 3, 4].map((i) => (
            <li key={i} style={{ animationDelay: `${i * 90}ms` }}>
              <span className="brain-skel-date" />
              <span className="brain-skel-lines">
                <span style={{ width: `${72 - i * 9}%` }} />
                <span style={{ width: `${44 + i * 6}%` }} />
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if ("error" in state) return <p className="form-error">{state.error}</p>;
  if (!state.items.length) return <p className="brain-meet-empty">{empty}</p>;

  const rows = state.items.map((m) => ({ m, item: toItem(m) }));
  const q = fold(query.trim());
  const shown = q ? rows.filter(({ item }) => fold(`${item.title} ${item.meta}`).includes(q)) : rows;

  return (
    <div className="brain-picker">
      <label className="brain-search">
        <Icon name="search" size={16} />
        <input
          ref={search}
          type="text"
          inputMode="search"
          placeholder="Buscar reunión, cliente o persona"
          aria-label="Buscar reunión"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQuery("");
          }}
        />
        {query ? (
          <button
            type="button"
            className="brain-search-x"
            aria-label="Borrar búsqueda"
            onClick={() => {
              setQuery("");
              search.current?.focus();
            }}
          >
            <Icon name="close" size={13} />
          </button>
        ) : (
          <span className="brain-search-n">{rows.length}</span>
        )}
      </label>

      {!shown.length ? (
        <p className="brain-meet-empty brain-picker-none">Ninguna reunión coincide con “{query.trim()}”.</p>
      ) : (
        <ul className="brain-picks q-scroll">
          {shown.map(({ m, item }) => {
            const d = item.date ? toDate(item.date) : null;
            return (
              <li key={item.key} className={item.loaded ? "loaded" : ""}>
                <span className="brain-pick-date" aria-hidden>
                  {d ? (
                    <>
                      <b>{d.toLocaleDateString("es-AR", { day: "numeric", timeZone: TZ })}</b>
                      <span>{d.toLocaleDateString("es-AR", { month: "short", timeZone: TZ }).replace(".", "")}</span>
                    </>
                  ) : (
                    <span>—</span>
                  )}
                </span>
                <span className="brain-pick-body">
                  <b title={item.title}>{item.title}</b>
                  <span>
                    {item.loaded && (
                      <i className="brain-pick-done">
                        <Icon name="check" size={12} strokeWidth={2.4} />
                        Ya cargada ·{" "}
                      </i>
                    )}
                    {d && <>{d.toLocaleDateString("es-AR", { weekday: "long", timeZone: TZ })}</>}
                    {item.note && <> · <em>{item.note}</em></>}
                    {item.meta && <> · {item.meta}</>}
                  </span>
                </span>
                {/* Siempre visible y en su lugar (pedido: flotando tapaba el texto). */}
                <button
                  type="button"
                  className={`brain-pick-go${item.loaded ? " again" : ""}`}
                  onClick={() => onPick(m)}
                  aria-label={`${item.loaded ? "Volver a cargar" : "Cargar"} “${item.title}” al cerebro`}
                  title={item.loaded ? "Ya está en el cerebro: cargarla de nuevo" : "Cargar al cerebro"}
                >
                  <Icon name={item.loaded ? "refresh" : "plus"} size={14} strokeWidth={2.2} />
                  <span>{item.loaded ? "Recargar" : "Cargar"}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
