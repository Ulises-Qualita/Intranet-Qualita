"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { type PortalStage, STAGE_NAME_MAX, STAGE_STATUSES, STAGES_MAX, type StageStatus } from "@/lib/portal";
import { savePortalStages } from "../../actions";

const newId = () => Math.random().toString(36).slice(2, 10);

// Editar portal → Etapas: la lista de etapas del proyecto, en orden, con su estado.
// De acá sale la card del % del portal. Se guarda la lista entera con "Guardar".
export function StagesEditor({
  clientId,
  stages,
  onCancel,
  onSaved,
}: {
  clientId: string;
  stages: PortalStage[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [list, setList] = useState<PortalStage[]>(stages);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const update = (id: string, change: Partial<PortalStage>) =>
    setList((l) => l.map((s) => (s.id === id ? { ...s, ...change } : s)));
  const move = (i: number, by: -1 | 1) =>
    setList((l) => {
      const next = [...l];
      [next[i], next[i + by]] = [next[i + by], next[i]];
      return next;
    });

  function save() {
    setError(null);
    if (list.some((s) => !s.name.trim())) return setError("Poné un nombre a cada etapa (o quitá las vacías).");
    startTransition(async () => {
      const result = await savePortalStages(clientId, list);
      if (!result.ok) return setError(result.error);
      router.refresh();
      onSaved();
    });
  }

  return (
    <>
      <div className="pe-panel">
        <p className="muted">
          En orden. El portal muestra el % de etapas completadas y, en &quot;Estamos en&quot;, la primera en curso (o, si no
          hay, la primera pendiente).
        </p>

        {list.length === 0 ? (
          <p className="pe-empty">Todavía no hay etapas. Sin etapas, el portal no muestra la card del avance.</p>
        ) : (
          <ol className="pe-stages">
            {list.map((s, i) => (
              <li key={s.id}>
                <span className="pe-num">{i + 1}</span>
                <input
                  value={s.name}
                  onChange={(e) => update(s.id, { name: e.target.value })}
                  maxLength={STAGE_NAME_MAX}
                  placeholder="Ej.: Diseño de la web"
                  aria-label={`Nombre de la etapa ${i + 1}`}
                  autoComplete="off"
                  disabled={pending}
                />
                <select
                  value={s.status}
                  onChange={(e) => update(s.id, { status: e.target.value as StageStatus })}
                  aria-label={`Estado de la etapa ${i + 1}`}
                  disabled={pending}
                  className={`st-${s.status}`}
                >
                  {STAGE_STATUSES.map((st) => (
                    <option key={st.value} value={st.value}>
                      {st.label}
                    </option>
                  ))}
                </select>
                <span className="pe-row-actions">
                  <button type="button" onClick={() => move(i, -1)} disabled={pending || i === 0} aria-label="Subir">
                    {"↑︎"}
                  </button>
                  <button type="button" onClick={() => move(i, 1)} disabled={pending || i === list.length - 1} aria-label="Bajar">
                    {"↓︎"}
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => setList((l) => l.filter((x) => x.id !== s.id))}
                    disabled={pending}
                    aria-label="Quitar etapa"
                  >
                    ×
                  </button>
                </span>
              </li>
            ))}
          </ol>
        )}

        {list.length < STAGES_MAX && (
          <button
            type="button"
            className="link-connect pe-add"
            onClick={() => setList((l) => [...l, { id: newId(), name: "", status: "todo" }])}
            disabled={pending}
          >
            <Icon name="plus" size={14} strokeWidth={2.2} />
            Agregar etapa
          </button>
        )}
      </div>

      {error && <p className="form-error modal-error">{error}</p>}

      <div className="modal-actions">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={pending}>
          Cancelar
        </button>
        <button type="button" className="btn-primary" onClick={save} disabled={pending}>
          {pending ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </>
  );
}
