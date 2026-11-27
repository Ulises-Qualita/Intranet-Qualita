"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { type MeetingDraft, RELEVANCE_LABEL } from "@/lib/brain-meetings-shared";
import { discardBrainMeeting, saveBrainMeeting } from "../actions";

// Revisión de los criterios y aprendizajes que Claude sacó de una reunión, antes
// de sumarlos al cerebro: se corrigen el título, la fecha y cada criterio, se
// sacan los que no van y se pueden agregar otros. Cerrar sin guardar borra el borrador.

let nextKey = 1;

export function MeetingReview({ draft, areaName, onClose }: { draft: MeetingDraft; areaName: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const saved = useRef(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(draft.title);
  const [metOn, setMetOn] = useState(draft.metOn ?? "");
  const [items, setItems] = useState(() => draft.insights.learnings.map((l) => ({ key: nextKey++, ...l })));
  const { relevance, relevanceNote } = draft.insights;
  const filled = items.map((i) => ({ title: i.title.trim(), detail: i.detail.trim() })).filter((i) => i.detail);
  const edit = (key: number, patch: { title?: string; detail?: string }) =>
    setItems((l) => l.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const close = () => {
    if (!pending) ref.current?.close();
  };

  const save = () =>
    startTransition(async () => {
      setError(null);
      const r = await saveBrainMeeting(draft.id, {
        title,
        metOn: metOn || null,
        insights: { learnings: filled, relevance, relevanceNote },
      });
      if (!r.ok) return setError(r.error);
      saved.current = true;
      router.refresh();
      ref.current?.close();
    });

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="meeting-review-title"
      onClose={() => {
        if (!saved.current) discardBrainMeeting(draft.id);
        onClose();
      }}
      onCancel={(e) => {
        if (pending) e.preventDefault();
      }}
    >
      <div className="modal-card metrics-modal brain-review">
        <h2 id="meeting-review-title">Revisá los criterios</h2>
        <p>
          Esto es lo que Claude sacó para el cerebro de {areaName} ({draft.words.toLocaleString("es-AR")} palabras leídas).
          Corregí lo que haga falta y sacá lo que no sirva.
        </p>

        <div className={`brain-relevance rel-${relevance}`}>
          <b>{RELEVANCE_LABEL[relevance]}</b>
          {relevanceNote && <span>{relevanceNote}</span>}
        </div>

        <div className="brain-review-head">
          <label>
            <span>Reunión</span>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </label>
          <label>
            <span>Fecha</span>
            <input className="input" type="date" value={metOn} onChange={(e) => setMetOn(e.target.value)} />
          </label>
        </div>
        {draft.participants.length > 0 && <p className="brain-meet-people">{draft.participants.join(", ")}</p>}

        <div className="brain-review-list">
          <h3>
            Criterios y aprendizajes <span>{filled.length}</span>
          </h3>
          {items.length ? (
            <ol>
              {items.map((item, i) => (
                <li key={item.key}>
                  <div className="brain-review-item">
                    <input
                      className="input brain-review-name"
                      value={item.title}
                      placeholder="Título corto"
                      maxLength={120}
                      aria-label={`Título del criterio ${i + 1}`}
                      onChange={(e) => edit(item.key, { title: e.target.value })}
                    />
                    <textarea
                      className="input"
                      rows={2}
                      value={item.detail}
                      placeholder="La regla y por qué"
                      aria-label={`Criterio ${i + 1}`}
                      onChange={(e) => edit(item.key, { detail: e.target.value })}
                    />
                  </div>
                  <button
                    type="button"
                    className="brain-pending-x"
                    aria-label={`Sacar el criterio ${i + 1}`}
                    onClick={() => setItems((l) => l.filter((x) => x.key !== item.key))}
                  >
                    <Icon name="close" size={13} />
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="brain-meet-empty">Esta reunión no dejó criterios de {areaName}. Podés agregar uno a mano o descartarla.</p>
          )}
          <button type="button" className="act-btn" onClick={() => setItems((l) => [...l, { key: nextKey++, title: "", detail: "" }])}>
            <Icon name="plus" size={14} />
            Agregar criterio
          </button>
        </div>

        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={close} disabled={pending}>
            Descartar
          </button>
          <button type="button" className="btn-secondary btn-primary" onClick={save} disabled={pending || !title.trim() || !filled.length}>
            {pending ? "Guardando…" : "Sumar al cerebro"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
