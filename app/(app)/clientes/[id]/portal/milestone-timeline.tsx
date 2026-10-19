import { integer } from "@/lib/format";
import type { NotionTicket } from "@/lib/notion-map";
import type { TaskStatus } from "@/lib/tasks";
import { TimelineScroller } from "./timeline-scroller";

// Un punto de la línea: un ticket de Notion del proyecto con el checkbox del
// portal tildado.
export type TimelineEntry = {
  id: string;
  title: string;
  description: string | null;
  // YYYY-MM-DD. La fecha límite: la única, o el fin si el ticket tiene rango.
  date: string;
  // Inicio, solo si el ticket tiene rango (inicio → fin).
  start: string | null;
  label: string;
  // Clase del color de la etiqueta (kind-*).
  tone: string;
};

// Estado de Notion traducido para el cliente (los internos no se muestran).
const TICKET_STATUS: Record<TaskStatus, { label: string; tone: string }> = {
  // Pedido: lo pendiente también se muestra como "En curso".
  todo: { label: "En curso", tone: "kind-curso" },
  doing: { label: "En curso", tone: "kind-curso" },
  blocked: { label: "En curso", tone: "kind-curso" },
  done: { label: "Completado", tone: "kind-completada" },
};

// Los tickets por fecha límite: todos se ubican igual, con o sin rango (uno con
// rango va en su fin, la entrega, y muestra también el inicio). Sin fecha no
// tiene dónde ir en la línea y queda afuera.
export function timelineEntries(tickets: NotionTicket[], cleanTitle: (t: string) => string) {
  const entries: TimelineEntry[] = tickets.flatMap((t) => {
    const date = t.dueEnd ?? t.dueDate;
    if (!date) return [];
    const start = t.dueEnd && t.dueDate && t.dueDate < t.dueEnd ? t.dueDate : null;
    return [{ id: t.id, title: cleanTitle(t.title), description: null, date, start, ...TICKET_STATUS[t.status] }];
  });
  return entries.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, "es"));
}

const DAY = 86_400_000;
const time = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
export const daysBetween = (from: string, to: string) => Math.round((time(to) - time(from)) / DAY);

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const longDay = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const dayMonth = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", timeZone: "UTC" });
const fmt = (f: Intl.DateTimeFormat, iso: string) => f.format(utc(iso)).replace(".", "");

// "20 oct 2026", o con rango "12 – 20 oct 2026", "28 sept – 5 oct 2026" y, si
// cambia el año, las dos fechas enteras.
function dateLabel(start: string | null, end: string) {
  if (!start) return fmt(longDay, end);
  if (start.slice(0, 4) !== end.slice(0, 4)) return `${fmt(longDay, start)} – ${fmt(longDay, end)}`;
  if (start.slice(0, 7) === end.slice(0, 7)) return `${Number(start.slice(8))} – ${fmt(longDay, end)}`;
  return `${fmt(dayMonth, start)} – ${fmt(longDay, end)}`;
}

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
export const activeIndex = (milestones: { date: string }[], today: string) => {
  const found = milestones.findIndex((m) => m.date >= today);
  return found === -1 ? milestones.length : found;
};

type Status = "completed" | "active" | "pending";

// La línea de hitos: el estilo del Timeline horizontal de Dice UI (punto de 14 px,
// conector de 2 px, título / fecha / descripción debajo) con un poco más: los
// cumplidos van con el degradado y un tilde, el activo es el próximo hito (o el de
// hoy), y el tramo que llega a él se llena según el tiempo que pasó desde el
// anterior, con una luz en la punta. Va en el Portal del cliente, con los tickets
// de Notion marcados para el portal.
export function MilestoneTimeline({ milestones, today }: { milestones: TimelineEntry[]; today: string }) {
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
            lastDone={i === active - 1}
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
  lastDone,
}: {
  m: TimelineEntry;
  // El último cumplido: de ahí sale el confeti.
  lastDone: boolean;
  // Orden en la línea: escalona la entrada.
  i: number;
  status: Status;
  // Conector hacia el siguiente (null en el último): cuánto está lleno.
  fill: number | null;
  today: string;
}) {
  const days = daysBetween(today, m.date);
  // Con rango: antes de empezar se cuenta hasta el inicio; empezado, hasta el fin.
  const started = !m.start || m.start <= today;
  const when = !m.start
    ? days === 0
      ? "Es hoy"
      : until(days)
    : started
      ? days === 0
        ? "Termina hoy"
        : `Termina ${until(days)}`
      : `Empieza ${until(daysBetween(today, m.start))}`;
  // El tramo que se está recorriendo (ni vacío ni lleno) lleva la luz en la punta.
  const travelling = fill !== null && fill > 0 && fill < 1;

  return (
    <li
      className={`tl-item ${status} ${m.tone}`}
      style={{ "--i": i } as React.CSSProperties}
      aria-current={status === "active" ? "step" : undefined}
      // Al abrir, si la línea no entra, se desplaza hasta el activo.
      data-today={status === "active" ? "" : undefined}
      // De acá sale el confeti al aparecer la línea (timeline-scroller.tsx).
      data-last-done={lastDone ? "" : undefined}
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
        <span className="tl-kind">{m.label}</span>
        <h3 className="tl-title">{m.title}</h3>
        <time className="tl-time" dateTime={m.start ? `${m.start}/${m.date}` : m.date}>
          {dateLabel(m.start, m.date)}
          {/* Cuánto dura, contando los dos días. */}
          {m.start && <span className="tl-span"> · {span(daysBetween(m.start, m.date) + 1)}</span>}
        </time>
        {m.description && <p className="tl-desc">{m.description}</p>}
        {/* Cuánto falta, en todos los que vienen (no en los cumplidos). */}
        {status !== "completed" && <span className="tl-when">{when}</span>}
      </div>
    </li>
  );
}
