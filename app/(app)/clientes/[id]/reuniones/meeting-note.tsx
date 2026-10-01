"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import { saveMeetingNote } from "./actions";

const MAX = 4000;

// Descripción de una reunión ya hecha, editable por el equipo. La cuenta del
// cliente la ve como texto (reuniones-view.tsx), sin este componente.
export function MeetingNote({
  clientSlug,
  meetingKey,
  notes,
  meta,
}: {
  clientSlug: string;
  meetingKey: string;
  notes: string | null;
  // "Editado por Ana, hace 2 días".
  meta: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveMeetingNote(clientSlug, meetingKey, draft);
      if (!result.ok) return setError(result.error);
      setEditing(false);
      router.refresh();
    });
  }

  if (!editing) {
    return notes ? (
      <div className="meet-note">
        <p>{notes}</p>
        <div className="meet-note-foot">
          {meta && <span>{meta}</span>}
          <button type="button" className="link-btn" onClick={() => (setDraft(notes), setEditing(true))}>
            Editar
          </button>
        </div>
      </div>
    ) : (
      <button type="button" className="meet-note-add" onClick={() => (setDraft(""), setEditing(true))}>
        <Icon name="plus" size={14} strokeWidth={2.2} />
        Agregar descripción
      </button>
    );
  }

  return (
    <form
      className="meet-note-form"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Qué se habló, qué se decidió, próximos pasos…"
        rows={4}
        maxLength={MAX}
        autoFocus
        disabled={pending}
        aria-label="Descripción de la reunión"
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditing(false);
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
        }}
      />
      {error && <p className="form-error">{error}</p>}
      <div className="meet-note-actions">
        <span className="muted">{draft.trim() ? "" : "Vacía se borra."}</span>
        <button type="button" className="btn-secondary" onClick={() => setEditing(false)} disabled={pending}>
          Cancelar
        </button>
        <button type="submit" className="connect-btn" disabled={pending}>
          {pending ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </form>
  );
}
