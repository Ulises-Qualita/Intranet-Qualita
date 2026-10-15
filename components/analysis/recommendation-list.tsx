"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import { RichText } from "@/components/agent/rich-text";
import type { Recommendation, RecStatus } from "@/lib/analysis/shared";
import { setRecommendationStatus } from "./actions";

const FILTERS = [
  { id: "pendiente", label: "Pendientes" },
  { id: "hecha", label: "Hechas" },
  { id: "descartada", label: "Descartadas" },
  { id: "todas", label: "Todas" },
] as const;
type Filter = (typeof FILTERS)[number]["id"];

const PRIORITY_PILL = { alta: "hot", media: "warm", baja: "pausado" } as const;

// Las recomendaciones de un análisis como lista para tildar: "Hecha" las marca
// como aplicadas y "Descartar" las saca de las pendientes. El cambio se ve al
// instante y se guarda en el server (con quién y cuándo).
export function RecommendationList({
  recommendations,
  names,
  path,
}: {
  recommendations: Recommendation[];
  // Nombre de cada miembro del equipo por id, para "Hecha por…".
  names: Record<string, string>;
  path: string;
}) {
  const [filter, setFilter] = useState<Filter>("pendiente");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [list, setOptimistic] = useOptimistic(
    recommendations,
    (current, change: { id: string; status: RecStatus }) =>
      current.map((r) => (r.id === change.id ? { ...r, status: change.status, statusAt: new Date().toISOString() } : r)),
  );

  function change(id: string, status: RecStatus) {
    setError(null);
    startTransition(async () => {
      setOptimistic({ id, status });
      const result = await setRecommendationStatus(id, status, path);
      if (!result.ok) setError(result.error);
    });
  }

  const count = (f: Filter) => (f === "todas" ? list.length : list.filter((r) => r.status === f).length);
  const shown = filter === "todas" ? list : list.filter((r) => r.status === filter);

  return (
    <div className="rec-list">
      <div className="rec-filters" role="tablist" aria-label="Filtrar recomendaciones">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            className={`chip${filter === f.id ? " on" : ""}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label} <span>{count(f.id)}</span>
          </button>
        ))}
      </div>

      {error && <p className="form-error">{error}</p>}

      {shown.length === 0 ? (
        <p className="rec-empty">
          {filter === "pendiente" ? "No quedan recomendaciones pendientes en este análisis." : "No hay recomendaciones acá."}
        </p>
      ) : (
        <ol className="recs">
          {shown.map((r) => (
            <li key={r.id} className={`rec ${r.status}`}>
              <button
                type="button"
                className="rec-check"
                role="checkbox"
                aria-checked={r.status === "hecha"}
                aria-label={r.status === "hecha" ? `Marcar "${r.title}" como pendiente` : `Marcar "${r.title}" como hecha`}
                onClick={() => change(r.id, r.status === "hecha" ? "pendiente" : "hecha")}
              >
                {r.status === "hecha" && <Icon name="check" size={14} strokeWidth={2.8} />}
              </button>

              <div className="rec-body">
                <div className="rec-head">
                  <h3>{r.title}</h3>
                  <span className={`pill ${PRIORITY_PILL[r.priority]}`}>Prioridad {r.priority}</span>
                </div>
                <div className="rec-meta">
                  <span className="rec-target">{r.target}</span>
                  <span>{r.category}</span>
                  <span>Esfuerzo {r.effort}</span>
                </div>
                <div className="rec-action">
                  <RichText>{r.action}</RichText>
                </div>
                <dl className="rec-why">
                  <div>
                    <dt>Por qué</dt>
                    <dd>
                      <RichText>{r.reason}</RichText>
                    </dd>
                  </div>
                  <div>
                    <dt>Impacto esperado</dt>
                    <dd>
                      <RichText>{r.impact}</RichText>
                    </dd>
                  </div>
                </dl>
                <div className="rec-foot">
                  {r.status !== "pendiente" && (
                    <span className="rec-status">
                      {r.status === "hecha" ? "Hecha" : "Descartada"}
                      {r.statusBy && names[r.statusBy] ? ` por ${names[r.statusBy]}` : ""}
                      {r.statusAt ? ` · ${new Date(r.statusAt).toLocaleDateString("es-AR", { day: "numeric", month: "short" })}` : ""}
                    </span>
                  )}
                  {r.status === "descartada" ? (
                    <button type="button" className="link-connect" onClick={() => change(r.id, "pendiente")}>
                      Volver a pendiente
                    </button>
                  ) : r.status === "pendiente" ? (
                    <button type="button" className="link-connect rec-dismiss" onClick={() => change(r.id, "descartada")}>
                      Descartar
                    </button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
