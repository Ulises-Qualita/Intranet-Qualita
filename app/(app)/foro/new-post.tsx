"use client";

import { useRef, useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import { FORUM_KINDS, type ForumKind } from "@/lib/forum-shared";
import { createPost } from "./actions";

export function NewPost() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [kind, setKind] = useState<ForumKind>(FORUM_KINDS[0].value);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function open() {
    formRef.current?.reset();
    setKind(FORUM_KINDS[0].value);
    setError(null);
    dialogRef.current?.showModal();
  }

  function close() {
    if (!pending) dialogRef.current?.close();
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await createPost(null, data);
      if (!result.ok) return setError(result.error);
      formRef.current?.reset();
      dialogRef.current?.close();
    });
  }

  return (
    <>
      <button type="button" className="connect-btn" onClick={open}>
        <Icon name="plus" size={16} strokeWidth={2} />
        Nuevo mensaje
      </button>

      <dialog
        ref={dialogRef}
        className="modal"
        aria-labelledby="new-post-title"
        onCancel={(e) => {
          // Escape no cierra mientras se está publicando: se perdería lo escrito.
          if (pending) e.preventDefault();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        <form ref={formRef} className="modal-card modal-form" onSubmit={submit} noValidate>
          <div className="modal-head">
            <h2 id="new-post-title">Nuevo mensaje</h2>
            <button type="button" className="modal-close" onClick={close} disabled={pending} aria-label="Cerrar">
              ×
            </button>
          </div>

          <div className="stack-form">
            <div>
              <span className="field-label">¿De qué se trata?</span>
              {/* Segmentado en vez de tres tarjetas: adentro del modal hay 520px y
                  las tarjetas con su descripción se apilaban una abajo de otra. */}
              <div className="forum-kinds" role="radiogroup" aria-label="De qué se trata">
                {FORUM_KINDS.map((k) => (
                  <button
                    type="button"
                    key={k.value}
                    role="radio"
                    aria-checked={kind === k.value}
                    className={kind === k.value ? "on" : ""}
                    onClick={() => setKind(k.value)}
                    disabled={pending}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
              <input type="hidden" name="kind" value={kind} />
              <p className="forum-kind-hint">{FORUM_KINDS.find((k) => k.value === kind)?.hint}</p>
            </div>

            <label>
              <span>Título</span>
              <input
                name="title"
                required
                maxLength={140}
                placeholder="En una línea, qué pasa o qué proponés"
                autoComplete="off"
                disabled={pending}
              />
            </label>

            <label>
              <span>Detalle</span>
              <textarea
                name="body"
                rows={5}
                maxLength={4000}
                disabled={pending}
                placeholder="Si es un error: qué hiciste, qué esperabas y qué pasó. Cuanto más concreto, más rápido se resuelve."
              />
            </label>
          </div>

          {error && <p className="form-error modal-error">{error}</p>}

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={close} disabled={pending}>
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={pending}>
              {pending ? "Publicando…" : "Publicar"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
