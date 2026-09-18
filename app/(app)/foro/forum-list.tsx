"use client";

// El foro entero en una pantalla, con cada mensaje abierto: se leen las respuestas
// y se contesta sin abrir nada. Lo único que se pliega es un detalle muy largo.
import { useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import { Pill } from "@/components/ui";
import { UserAvatar } from "@/components/user-avatar";
import { relativeTime } from "@/lib/format";
import { FORUM_STATUSES, kindLabel, statusMeta, type ForumThread } from "@/lib/forum-shared";
import { addComment, deleteComment, deletePost, setPinned, setStatus } from "./actions";

// A partir de acá el detalle se recorta. Se mide por texto y no por altura real
// para no depender de un efecto que lea el DOM después de pintar.
const LARGO = 340;
const RENGLONES = 6;

function Detalle({ text }: { text: string }) {
  const [abierto, setAbierto] = useState(false);
  const largo = text.length > LARGO || text.split("\n").length > RENGLONES;

  if (!largo) return <div className="forum-body">{text}</div>;

  return (
    <div className="forum-body-wrap">
      <div className={`forum-body${abierto ? "" : " recortado"}`}>{text}</div>
      <button type="button" className="forum-more" onClick={() => setAbierto((v) => !v)}>
        {abierto ? "Ver menos" : "Ver más"}
      </button>
    </div>
  );
}

export function ForumList({
  threads,
  currentUserId,
  isAdmin,
}: {
  threads: ForumThread[];
  currentUserId: string;
  isAdmin: boolean;
}) {
  // Qué mensaje está esperando una acción: así se deshabilita solo esa tarjeta y
  // no el foro entero mientras se guarda algo.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const [, startTransition] = useTransition();

  const run = (id: string, fn: () => Promise<{ ok: boolean; error: string | null }>, after?: () => void) => {
    setError(null);
    setBusyId(id);
    startTransition(async () => {
      const result = await fn();
      setBusyId(null);
      if (result.ok) after?.();
      else setError({ id, message: result.error ?? "No se pudo completar la acción." });
    });
  };

  function reply(event: React.FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    // Se guarda el nodo antes del await: después de la transición currentTarget
    // ya es null.
    const form = event.currentTarget;
    run(id, () => addComment(null, new FormData(form)), () => form.reset());
  }

  return (
    <div className="forum-list">
      {threads.map((t) => {
        const status = statusMeta(t.status);
        const busy = busyId === t.id;
        const puedeBorrar = isAdmin || t.author?.id === currentUserId;

        // El tipo pinta el filo izquierdo de la tarjeta: se barre la lista por
        // color sin que una etiqueta grande le robe lugar al título.
        return (
          <article key={t.id} className={`forum-item ${t.kind}${t.pinned ? " fijado" : ""}`}>
            <header className="forum-head">
              {t.author && <UserAvatar className="forum-av" name={t.author.name} avatarUrl={t.author.avatarUrl} />}
              <div className="forum-head-main">
                <b>{t.title}</b>
                <span className="forum-meta">
                  {t.pinned && <span className="forum-pin">Fijado</span>}
                  <span className="forum-kind">{kindLabel(t.kind)}</span>
                  {t.author?.name ?? "Alguien que ya no está"} · {relativeTime(t.created_at)}
                </span>
              </div>
              <Pill variant={status.pill}>{status.label}</Pill>
            </header>

            {t.body && <Detalle text={t.body} />}

            {(isAdmin || puedeBorrar) && (
              <div className="forum-tools">
                {isAdmin && (
                  <label className="forum-status">
                    <span>Estado</span>
                    <select value={t.status} disabled={busy} onChange={(e) => run(t.id, () => setStatus(t.id, e.target.value))}>
                      {FORUM_STATUSES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {isAdmin && (
                  <button
                    type="button"
                    className="forum-act"
                    disabled={busy}
                    onClick={() => run(t.id, () => setPinned(t.id, !t.pinned))}
                  >
                    {t.pinned ? "Quitar de arriba" : "Fijar arriba"}
                  </button>
                )}
                {puedeBorrar && (
                  <button type="button" className="forum-del" disabled={busy} onClick={() => run(t.id, () => deletePost(t.id))}>
                    Borrar mensaje
                  </button>
                )}
              </div>
            )}

            {t.comments.length > 0 && (
              <div className="forum-replies">
                {t.comments.map((c) => (
                  <div className="forum-reply" key={c.id}>
                    {c.author && <UserAvatar className="forum-av sm" name={c.author.name} avatarUrl={c.author.avatarUrl} />}
                    <div className="forum-reply-main">
                      <div className="forum-reply-head">
                        <b>{c.author?.name ?? "Alguien que ya no está"}</b>
                        <span>{relativeTime(c.created_at)}</span>
                        {(isAdmin || c.author?.id === currentUserId) && (
                          <button
                            type="button"
                            title="Borrar respuesta"
                            aria-label="Borrar respuesta"
                            disabled={busy}
                            onClick={() => run(t.id, () => deleteComment(c.id))}
                          >
                            <Icon name="close" size={13} />
                          </button>
                        )}
                      </div>
                      <p>{c.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={(e) => reply(e, t.id)} className="forum-reply-form">
              <input type="hidden" name="postId" value={t.id} />
              <textarea
                name="body"
                rows={1}
                required
                maxLength={4000}
                disabled={busy}
                placeholder="Sumá algo, o contá cómo se resolvió…"
              />
              <button type="submit" className="connect-btn" disabled={busy}>
                {busy ? "Enviando…" : "Responder"}
              </button>
            </form>

            {error?.id === t.id && <p className="form-error">{error.message}</p>}
          </article>
        );
      })}
    </div>
  );
}
