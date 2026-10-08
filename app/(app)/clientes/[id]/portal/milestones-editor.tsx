"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { kindLabel, MILESTONE_KINDS, MILESTONE_MAX, type Milestone, type MilestoneInput } from "@/lib/milestones-shared";
import { deleteMilestone, saveMilestone } from "./milestone-actions";

const shortDay = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const fmt = (iso: string) => shortDay.format(new Date(`${iso}T00:00:00Z`)).replace(".", "");

// Editar portal → Hitos: la lista de hitos (intranet_client_milestones) con
// agregar, editar y eliminar. Cada cambio se guarda al momento (no espera al
// "Guardar" del modal) y refresca el portal; la lista llega de nuevo del server.
export function MilestonesEditor({
  clientSlug,
  milestones,
  missing,
  onClose,
}: {
  clientSlug: string;
  milestones: Milestone[];
  // Falta correr docs/sql/2026-10-08-hitos.sql.
  missing: boolean;
  onClose: () => void;
}) {
  // Qué se está editando: el id de un hito, "new" para uno nuevo, o nada.
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<MilestoneInput>({ kind: "hito", title: "", description: "", date: "" });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const hasStart = milestones.some((m) => m.kind === "inicio");

  function edit(m: Milestone | null) {
    setError(null);
    setConfirmDelete(false);
    setEditing(m ? m.id : "new");
    // Si el proyecto todavía no tiene inicio, el primero se propone como Inicio.
    setForm(m ? { ...m, description: m.description ?? "" } : { kind: hasStart ? "hito" : "inicio", title: "", description: "", date: "" });
  }

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) return setError(result.error);
      setEditing(null);
      router.refresh();
    });
  }

  const set = <K extends keyof MilestoneInput>(key: K, value: MilestoneInput[K]) => setForm((f) => ({ ...f, [key]: value }));

  const formFor = (id: string | null) => (
    <div className="pe-ms-form stack-form">
      <div className="form-row">
        <label>
          <span>Tipo</span>
          <select value={form.kind} onChange={(e) => set("kind", e.target.value as MilestoneInput["kind"])} disabled={pending}>
            {MILESTONE_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Fecha</span>
          <input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} disabled={pending} />
        </label>
      </div>
      <label>
        <span>Título</span>
        <input
          value={form.title}
          onChange={(e) => set("title", e.target.value)}
          maxLength={MILESTONE_MAX.title}
          placeholder={form.kind === "inicio" ? "Ej.: Arranque del proyecto" : "Ej.: Entrega del manual de marca"}
          autoComplete="off"
          disabled={pending}
          autoFocus
        />
      </label>
      <label>
        <span>Descripción (opcional)</span>
        <textarea
          value={form.description ?? ""}
          onChange={(e) => set("description", e.target.value)}
          maxLength={MILESTONE_MAX.description}
          rows={2}
          placeholder="Qué incluye o qué significa para el proyecto"
          disabled={pending}
        />
      </label>
      <div className="pe-ms-actions">
        {id &&
          (confirmDelete ? (
            <button type="button" className="link-danger" onClick={() => run(() => deleteMilestone(clientSlug, id))} disabled={pending}>
              Sí, eliminar
            </button>
          ) : (
            <button type="button" className="link-danger" onClick={() => setConfirmDelete(true)} disabled={pending}>
              Eliminar
            </button>
          ))}
        <button type="button" className="btn-secondary btn-sm" onClick={() => setEditing(null)} disabled={pending}>
          Cancelar
        </button>
        <button type="button" className="btn-primary btn-sm" onClick={() => run(() => saveMilestone(clientSlug, id, form))} disabled={pending}>
          {pending ? "Guardando…" : id ? "Guardar" : "Agregar"}
        </button>
      </div>
    </div>
  );

  if (missing) {
    return (
      <>
        <div className="pe-panel">
          <p className="pe-empty">
            Para cargar hitos hay que correr <b>docs/sql/2026-10-08-hitos.sql</b> en Supabase.
          </p>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="pe-panel">
        <p className="muted">Los momentos importantes del proyecto, con su fecha. Cada cambio se guarda al momento.</p>

        {milestones.length === 0 && editing !== "new" && (
          <p className="pe-empty">Todavía no hay hitos. Empezá por la fecha en que arrancó el proyecto.</p>
        )}

        {milestones.length > 0 && (
          <ul className="pe-ms">
            {milestones.map((m) =>
              editing === m.id ? (
                <li key={m.id} className="editing">
                  {formFor(m.id)}
                </li>
              ) : (
                <li key={m.id}>
                  <span className={`pe-kind kind-${m.kind}`}>{kindLabel(m.kind)}</span>
                  <div>
                    <b>{m.title}</b>
                    <time dateTime={m.date}>{fmt(m.date)}</time>
                  </div>
                  <button type="button" className="link-btn" onClick={() => edit(m)} disabled={pending || editing !== null}>
                    Editar
                  </button>
                </li>
              ),
            )}
          </ul>
        )}

        {editing === "new" ? (
          <div className="pe-ms-new">{formFor(null)}</div>
        ) : (
          <button type="button" className="link-connect pe-add" onClick={() => edit(null)} disabled={pending || editing !== null}>
            <Icon name="plus" size={14} strokeWidth={2.2} />
            Agregar hito
          </button>
        )}
      </div>

      {error && <p className="form-error modal-error">{error}</p>}

      <div className="modal-actions">
        <button type="button" className="btn-secondary" onClick={onClose} disabled={pending}>
          Cerrar
        </button>
      </div>
    </>
  );
}
