"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { WEEKDAYS, type CalBar, type CalEvent, type CalMonth } from "@/lib/notion-blocks";

// Umbral del gesto: menos que esto es un toque o un scroll vertical torcido.
const SWIPE_PX = 50;

const dayLabel = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const fullDay = (iso: string) => {
  const text = dayLabel.format(new Date(`${iso}T12:00:00Z`));
  return text.charAt(0).toUpperCase() + text.slice(1);
};

// Calendario de una database embebida, un mes a la vez como la vista de Notion:
// título del mes a la izquierda y "‹ Hoy ›" a la derecha. En touch se pasa de mes
// deslizando. Los meses llegan armados desde el server; acá solo se elige cuál ver.
// Cada evento (fila de Notion o reunión) abre su detalle en un diálogo.
// `twoLines`: la database tiene Entregable y cada evento lo muestra debajo del título.
export function NotionCalendar({ months, initial, twoLines = false }: { months: CalMonth[]; initial: number; twoLines?: boolean }) {
  const [index, setIndex] = useState(initial);
  const [open, setOpen] = useState<CalBar | null>(null);
  // Evento bajo el mouse: resalta todas sus barras (un rango que cruza de semana tiene dos).
  const [hot, setHot] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const month = months[index];
  // Si el roadmap ya terminó o no empezó, abre en un extremo y "Hoy" mentiría.
  const hasToday = months[initial]?.weeks.some((w) => w.days.some((d) => d.isToday && d.inMonth)) ?? false;
  const go = (i: number) => setIndex(Math.min(months.length - 1, Math.max(0, i)));

  function show(bar: CalBar) {
    setOpen(bar);
    dialog.current?.showModal();
  }
  const close = () => dialog.current?.close();

  return (
    <div className={`nd-cal${twoLines ? " two-lines" : ""}`}>
      {month && (
        <div
          className="nd-cal-month"
          onTouchStart={(e) => {
            const t = e.touches[0];
            touch.current = { x: t.clientX, y: t.clientY };
          }}
          onTouchEnd={(e) => {
            const start = touch.current;
            touch.current = null;
            if (!start) return;
            const t = e.changedTouches[0];
            const dx = t.clientX - start.x;
            if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(t.clientY - start.y)) return;
            go(index + (dx < 0 ? 1 : -1));
          }}
        >
          <div className="nd-cal-head">
            <div className="nd-cal-title" aria-live="polite">
              {month.label}
            </div>
            {months.length > 1 && (
              <div className="nd-cal-nav">
                <button
                  type="button"
                  className="nd-cal-btn"
                  onClick={() => go(index - 1)}
                  disabled={index === 0}
                  aria-label="Mes anterior"
                >
                  <Icon name="chevron" size={15} className="flip" />
                </button>
                {hasToday && (
                  <button
                    type="button"
                    className="nd-cal-btn today"
                    onClick={() => go(initial)}
                    disabled={index === initial}
                  >
                    Hoy
                  </button>
                )}
                <button
                  type="button"
                  className="nd-cal-btn"
                  onClick={() => go(index + 1)}
                  disabled={index === months.length - 1}
                  aria-label="Mes siguiente"
                >
                  <Icon name="chevron" size={15} />
                </button>
              </div>
            )}
          </div>

          {/* key por mes: remonta la grilla y dispara la animación de entrada. */}
          <div key={month.key} className="nd-cal-grid">
            {WEEKDAYS.map((d) => (
              <div key={d} className="nd-cal-wd">
                {d}
              </div>
            ))}
            {month.weeks.map((week) => (
              // Una fila por semana: los 7 días de fondo y encima una barra por
              // evento, que ocupa sus columnas (un solo botón aunque dure varios días).
              <div
                key={week.days[0].iso}
                className="nd-cal-week"
                style={{ gridTemplateRows: `var(--num-h) repeat(${week.lanes}, var(--ev-h)) minmax(var(--week-pad), 1fr)` }}
              >
                {week.days.map((day, i) => (
                  <div
                    key={day.iso}
                    className={`nd-cal-day${day.inMonth ? "" : " out"}${day.isToday ? " today" : ""}`}
                    style={{ gridColumn: i + 1 }}
                  >
                    <span className="nd-cal-num">{day.day}</span>
                  </div>
                ))}
                {week.bars.map((bar) => {
                  const e = bar.event;
                  const classes = [
                    "nd-ev",
                    // Reunión de Google Calendar (no es una fila de Notion): magenta, con hora.
                    // Tarea: tarjeta clara con la franja del color de su etapa en Notion.
                    e.kind === "meeting" ? `nd-meet${e.done ? " past" : ""}` : `nd-task acc-${e.color}`,
                    bar.fromPrev && "from-prev",
                    bar.toNext && "to-next",
                    // Un rango que cruza de semana son dos barras: se resaltan juntas.
                    hot === e.id && "hot",
                  ].filter(Boolean);
                  return (
                    <button
                      key={e.id}
                      type="button"
                      className={classes.join(" ")}
                      style={{ gridColumn: `${bar.col + 1} / span ${bar.span}`, gridRow: bar.lane + 2 }}
                      onClick={() => show(bar)}
                      onMouseEnter={() => setHot(e.id)}
                      onMouseLeave={() => setHot(null)}
                      title={e.kind === "meeting" ? `Reunión ${e.time ?? ""} · ${e.title}` : e.title}
                    >
                      <span className="nd-ev-txt">
                        {e.kind === "meeting" && (
                          <>
                            <Icon name="calendar" size={12} strokeWidth={2.2} />
                            {/* Con dos líneas la hora ya va en el subtítulo. */}
                            {e.time && !twoLines && <b>{e.time}</b>}{" "}
                          </>
                        )}
                        {e.title}
                      </span>
                      {twoLines && (
                        <span className="nd-ev-txt nd-ev-sub">
                          {e.badges?.length
                            ? e.badges.map((b) => (
                                <span key={b.name} className={`nd-badge c-${b.color}`}>
                                  {b.name}
                                </span>
                              ))
                            : e.subtitle || " "}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      <dialog
        ref={dialog}
        className="modal"
        aria-labelledby="nd-ev-title"
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
        onClose={() => setOpen(null)}
      >
        {open && <EventDetail event={open.event} start={open.start} end={open.end} onClose={close} />}
      </dialog>
    </div>
  );
}

function EventDetail({ event, start, end, onClose }: { event: CalEvent; start: string; end: string; onClose: () => void }) {
  const meeting = event.kind === "meeting";
  return (
    <div className="modal-card modal-form nd-detail">
      <div className="modal-head">
        <span className={meeting ? `nd-detail-kind meet${event.done ? " past" : ""}` : `nd-detail-kind nd-tag c-${event.color}`}>
          {meeting ? (event.done ? "Reunión realizada" : "Reunión") : "Tarea"}
        </span>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Cerrar">
          ×
        </button>
      </div>

      <h2 id="nd-ev-title">{event.title}</h2>
      <p className="nd-detail-date">
        <Icon name="calendar" size={15} strokeWidth={2} />
        {end > start ? `${fullDay(start)} → ${fullDay(end)}` : fullDay(start)}
      </p>

      {event.details.length > 0 && (
        <dl className="nd-detail-props">
          {event.details.map((d) => (
            <div key={d.label}>
              <dt>{d.label}</dt>
              <dd>{d.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {meeting && event.done && (
        <div className="nd-detail-notes">
          <b>Qué se habló</b>
          <p className={event.notes ? undefined : "empty"}>{event.notes ?? "Todavía no hay una descripción de esta reunión."}</p>
        </div>
      )}

      {meeting && event.href && (
        <a className="connect-btn nd-detail-join" href={event.href} target="_blank" rel="noopener noreferrer">
          Unirse a la reunión
        </a>
      )}
    </div>
  );
}
