import { PROJECT_STAGES, type PortalPhase, phasePercent, stageIndex } from "@/lib/portal";

// ∞ dibujado (no el carácter: Lexend no lo trae y el de respaldo queda chico),
// con el degradado de marca.
function InfinityMark() {
  return (
    <svg viewBox="0 0 40 20" width="34" height="17" aria-hidden>
      <defs>
        <linearGradient id="pt-inf-grad" x1="0" x2="1">
          <stop offset="0" style={{ stopColor: "var(--magenta)" }} />
          <stop offset="1" style={{ stopColor: "var(--coral)" }} />
        </linearGradient>
      </defs>
      <path
        d="M20 10c-3.2-4.2-6.2-6.3-9-6.3a6.3 6.3 0 0 0 0 12.6c2.8 0 5.8-2.1 9-6.3Zm0 0c3.2 4.2 6.2 6.3 9 6.3a6.3 6.3 0 0 0 0-12.6c-2.8 0-5.8 2.1-9 6.3Z"
        fill="none"
        stroke="url(#pt-inf-grad)"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Card de avance del portal: las tres etapas fijas (Editar portal → Etapas).
// Arquitectura e Infraestructura son la construcción y el anillo marca su avance
// (50% cada una, más lo que lleva la actual). Motor de Demanda es un servicio
// mensual: el anillo queda lleno y en lugar del % va ∞.
export function PortalProgress({ phase }: { phase: PortalPhase }) {
  const pct = phasePercent(phase);
  const current = stageIndex(phase.stage);
  const stage = PROJECT_STAGES[current];

  return (
    <div className="pt-glass pt-now">
      <div
        className={`pt-ring${pct === null ? " ongoing" : ""}`}
        style={{ "--p": pct ?? 100 } as React.CSSProperties}
        role="img"
        aria-label={pct === null ? "Servicio mensual en curso" : `Avance del proyecto: ${pct}%`}
      >
        <b>{pct === null ? <InfinityMark /> : `${pct}%`}</b>
      </div>
      <div className="pt-now-txt">
        <small>Estamos en</small>
        <h3>{stage.name}</h3>
        <p>{stage.ongoing ? "Servicio mensual activo" : `Etapa ${current + 1} de ${PROJECT_STAGES.length}`}</p>
      </div>
      <ol className="pt-steps" aria-label="Etapas del proyecto">
        {PROJECT_STAGES.map((s, i) => {
          const status = i < current ? "done" : i > current ? "todo" : s.ongoing ? "ongoing" : "doing";
          return (
            <li
              key={s.id}
              className={`${status}${i === current ? " current" : ""}`}
              style={status === "doing" ? ({ "--s": phase.progress } as React.CSSProperties) : undefined}
            >
              <i aria-hidden />
              <span>{s.name}</span>
              <span className="pt-sr">
                : {status === "done" ? "completada" : status === "todo" ? "pendiente" : status === "ongoing" ? "en curso, servicio mensual" : `en curso, ${phase.progress}%`}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
