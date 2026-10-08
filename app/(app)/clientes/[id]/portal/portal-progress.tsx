import type { PortalStage } from "@/lib/portal";

// La etapa en la que estamos: la primera en curso; si no hay, la primera
// pendiente. null si están todas completadas.
function currentIndex(stages: PortalStage[]) {
  const doing = stages.findIndex((s) => s.status === "doing");
  if (doing !== -1) return doing;
  const next = stages.findIndex((s) => s.status !== "done");
  return next === -1 ? null : next;
}

// Card de avance del portal (el anillo), con las etapas del proyecto que define el
// equipo en Editar portal → Etapas: % = completadas sobre el total y "Estamos en"
// la etapa actual. A la derecha, una barra con un segmento por etapa.
export function PortalProgress({ stages }: { stages: PortalStage[] }) {
  const done = stages.filter((s) => s.status === "done").length;
  const pct = Math.round((done / stages.length) * 100);
  const current = currentIndex(stages);
  const stage = current === null ? null : stages[current];

  return (
    <div className="pt-glass pt-now">
      <div className="pt-ring" style={{ "--p": pct } as React.CSSProperties} role="img" aria-label={`Avance del proyecto: ${pct}%`}>
        <b>{pct}%</b>
      </div>
      <div className="pt-now-txt">
        {stage ? (
          <>
            <small>Estamos en</small>
            <h3>{stage.name}</h3>
            <p>
              Etapa {current! + 1} de {stages.length}
            </p>
          </>
        ) : (
          <>
            <small>Proyecto</small>
            <h3>Todas las etapas completadas</h3>
            <p>{stages.length === 1 ? "La etapa del proyecto está terminada." : `Las ${stages.length} etapas están terminadas.`}</p>
          </>
        )}
      </div>
      <ol className="pt-steps" aria-label="Etapas del proyecto">
        {stages.map((s, i) => (
          <li key={s.id} className={`${s.status}${i === current ? " current" : ""}`} title={s.name}>
            <span className="pt-sr">
              {s.name}: {s.status === "done" ? "completada" : s.status === "doing" ? "en curso" : "pendiente"}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
