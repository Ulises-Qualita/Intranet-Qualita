import { integer } from "@/lib/format";
import { kindLabel, type Milestone } from "@/lib/milestones-shared";
import { TimelineScroller } from "./timeline-scroller";

const DAY = 86_400_000;
const time = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
export const daysBetween = (from: string, to: string) => Math.round((time(to) - time(from)) / DAY);

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const longDay = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

// "12 días", "3 meses", "1 año y 2 meses".
function span(days: number) {
  if (days < 45) return days === 1 ? "1 día" : `${integer(days)} días`;
  const months = Math.round(days / 30.44);
  if (months < 12) return `${months} meses`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const y = years === 1 ? "1 año" : `${years} años`;
  return rest ? `${y} y ${rest === 1 ? "1 mes" : `${rest} meses`}` : y;
}

export const until = (days: number) => (days === 0 ? "hoy" : days === 1 ? "mañana" : `en ${span(days)}`);

// El hito activo: el primero de hoy en adelante. Si ya pasaron todos, no hay
// (devuelve milestones.length). Los anteriores cuentan como cumplidos.
export const activeIndex = (milestones: Milestone[], today: string) => {
  const found = milestones.findIndex((m) => m.date >= today);
  return found === -1 ? milestones.length : found;
};

type Status = "completed" | "active" | "pending";

// La línea de hitos: el estilo del Timeline horizontal de Dice UI (punto de 14 px,
// conector de 2 px, título / fecha / descripción debajo) con un poco más: los
// cumplidos van con el degradado y un tilde, el activo es el próximo hito (o el de
// hoy), y el tramo que llega a él se llena según el tiempo que pasó desde el
// anterior, con una luz en la punta. Va en el Portal del cliente; los hitos se
// cargan en Editar portal → Hitos.
export function MilestoneTimeline({ milestones, today }: { milestones: Milestone[]; today: string }) {
  const active = activeIndex(milestones, today);
  const status = (i: number): Status => (i < active ? "completed" : i === active ? "active" : "pending");
  // Cuánto se llenó el tramo que va del hito i al siguiente (0 a 1).
  const fill = (i: number) => {
    if (i + 1 < active) return 1;
    if (i + 1 > active || i + 1 >= milestones.length) return 0;
    const from = time(milestones[i].date);
    const to = time(milestones[i + 1].date);
    return to > from ? Math.min(1, Math.max(0, (time(today) - from) / (to - from))) : 1;
  };

  return (
    <TimelineScroller>
      <ol className="tl">
        {milestones.map((m, i) => (
          <TimelineItem
            key={m.id}
            m={m}
            i={i}
            status={status(i)}
            fill={i < milestones.length - 1 ? fill(i) : null}
            today={today}
          />
        ))}
      </ol>
    </TimelineScroller>
  );
}

function TimelineItem({
  m,
  i,
  status,
  fill,
  today,
}: {
  m: Milestone;
  // Orden en la línea: escalona la entrada.
  i: number;
  status: Status;
  // Conector hacia el siguiente (null en el último): cuánto está lleno.
  fill: number | null;
  today: string;
}) {
  const days = daysBetween(today, m.date);
  // El tramo que se está recorriendo (ni vacío ni lleno) lleva la luz en la punta.
  const travelling = fill !== null && fill > 0 && fill < 1;

  return (
    <li
      className={`tl-item ${status} kind-${m.kind}`}
      style={{ "--i": i } as React.CSSProperties}
      aria-current={status === "active" ? "step" : undefined}
      // Al abrir, si la línea no entra, se desplaza hasta el activo.
      data-today={status === "active" ? "" : undefined}
    >
      <span className="tl-dot" aria-hidden>
        {status === "completed" && (
          <svg viewBox="0 0 12 12" width="8" height="8">
            <path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      {fill !== null && (
        <span className={`tl-connector${travelling ? " travelling" : ""}`} style={{ "--fill": fill } as React.CSSProperties} aria-hidden />
      )}
      <div className="tl-content">
        <span className="tl-kind">{kindLabel(m.kind)}</span>
        <h3 className="tl-title">{m.title}</h3>
        <time className="tl-time" dateTime={m.date}>
          {longDay.format(utc(m.date)).replace(".", "")}
        </time>
        {m.description && <p className="tl-desc">{m.description}</p>}
        {/* Cuánto falta, en todos los que vienen (no en los cumplidos). */}
        {status !== "completed" && <span className="tl-when">{days === 0 ? "Es hoy" : until(days)}</span>}
      </div>
    </li>
  );
}
