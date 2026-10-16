"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { type CalMeeting, weekOf } from "@/app/(app)/clientes/[id]/reuniones/meetings-calendar";

// Semana con las horas en filas, como Google Calendar, pero con el estilo del
// calendario del portal (las clases de NotionCalendar, en vidrio dentro de
// .pt-cal). Cada reunión va en su horario y con el alto de lo que dura; las de
// todo el día y las que caen enteras fuera del horario visible, en franjas
// aparte (arriba y abajo), así ninguna queda en una hora que no es la suya.
// Las reuniones con clientes van en navy (.nd-meet) y el resto del calendario,
// como las tareas del portal (.nd-task, lavanda).

// Alto de una hora: con 72 px una reunión de 10 minutos todavía entra en una línea.
const HOUR_PX = 72;
// Horario que se ve (pedido: de 9 a 18).
const DAY_START = 9;
const DAY_END = 18;
// Alto mínimo de un bloque (una reunión de 5 minutos). Nunca se estira la
// duración: el bloque termina en la línea de su hora de fin, como en Google.
const MIN_PX = 9;
const SWIPE_PX = 50;
const WEEKDAYS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
const TZ = "America/Argentina/Buenos_Aires";

const utc = (iso: string) => new Date(`${iso}T12:00:00Z`);
const addDays = (iso: string, n: number) => new Date(utc(iso).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const dayMonth = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", timeZone: "UTC" });
const dayOnly = new Intl.DateTimeFormat("es-AR", { day: "numeric", timeZone: "UTC" });
const minutesOf = (label: string) => {
  const [h, m] = label.split(":").map(Number);
  return h * 60 + m;
};

// "13 – 19 de octubre" o "29 de septiembre – 5 de octubre".
function weekLabel(monday: string) {
  const sunday = addDays(monday, 6);
  return `${(monday.slice(0, 7) === sunday.slice(0, 7) ? dayOnly : dayMonth).format(utc(monday))} – ${dayMonth.format(utc(sunday))}`;
}

type Timed = { m: CalMeeting; start: number; end: number };
type Placed = Timed & { col: number; cols: number };

const eventTitle = (m: CalMeeting) =>
  `${m.client ? `${m.client} · ` : ""}${m.title}
${m.startLabel ? `${m.startLabel} – ${m.endLabel} hs` : "Todo el día"}`;

// Las reuniones con hora de un día, separadas en las que se ven en la grilla
// (recortadas al horario visible si lo pasan en parte) y las que caen enteras
// antes de las 9 o después de las 18.
function splitDay(list: CalMeeting[]) {
  const from = DAY_START * 60;
  const to = DAY_END * 60;
  const timed: Timed[] = [];
  const early: CalMeeting[] = [];
  const late: CalMeeting[] = [];
  for (const m of list) {
    if (!m.startLabel) continue;
    const realStart = minutesOf(m.startLabel);
    const rawEnd = minutesOf(m.endLabel);
    // Pasada la medianoche, hasta el final del día.
    const realEnd = rawEnd > realStart ? rawEnd : 24 * 60;
    if (realEnd <= from) early.push(m);
    else if (realStart >= to) late.push(m);
    else {
      const start = Math.max(realStart, from);
      const end = Math.min(realEnd, to);
      timed.push({ m, start, end });
    }
  }
  timed.sort((a, b) => a.start - b.start || b.end - a.end);
  return { timed, early, late };
}

// Clases de un evento: navy si es con un cliente, como tarea del portal si no.
const evClass = (m: CalMeeting) =>
  ["nd-ev", "ws-ev", m.client ? "nd-meet" : "nd-task acc-lavender", m.status === "past" && "past"].filter(Boolean).join(" ");

// Las que se superponen se reparten el ancho: cada grupo que se pisa usa tantas
// columnas como reuniones simultáneas.
function placeDay(timed: Timed[]): Placed[] {
  const placed: Placed[] = [];
  let group: (Timed & { col: number })[] = [];
  let groupEnd = -1;
  const close = () => {
    const cols = Math.max(0, ...group.map((p) => p.col)) + 1;
    placed.push(...group.map((p) => ({ ...p, cols })));
    group = [];
  };
  for (const e of timed) {
    if (e.start >= groupEnd && group.length) close();
    const busy = new Set(group.filter((p) => p.end > e.start).map((p) => p.col));
    let col = 0;
    while (busy.has(col)) col++;
    group.push({ ...e, col });
    groupEnd = Math.max(groupEnd, e.end);
  }
  if (group.length) close();
  return placed;
}

// Día y minuto actuales en Argentina; null hasta montar, así el server y el
// navegador no dibujan la línea de "ahora" en lugares distintos.
function useNow() {
  const [now, setNow] = useState<{ day: string; minutes: number } | null>(null);
  useEffect(() => {
    const tick = () => {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: TZ,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(new Date());
      const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
      setNow({ day: `${get("year")}-${get("month")}-${get("day")}`, minutes: Number(get("hour")) * 60 + Number(get("minute")) });
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function WeekSchedule({
  meetings,
  today,
  onOpen,
}: {
  meetings: CalMeeting[];
  today: string;
  onOpen: (key: string) => void;
}) {
  const thisWeek = weekOf(today);
  // Se navega entre la primera y la última semana con reuniones (siempre incluye la actual).
  const [first, last] = useMemo(() => {
    const weeks = [thisWeek, ...meetings.map((m) => weekOf(m.day))].sort();
    return [weeks[0], weeks[weeks.length - 1]];
  }, [meetings, thisWeek]);
  const [monday, setMonday] = useState(thisWeek);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const now = useNow();

  const go = (n: number) => {
    const next = addDays(monday, 7 * n);
    if (next >= first && next <= last) setMonday(next);
  };

  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const byDay = days.map((d) => meetings.filter((m) => m.day === d));
  const split = byDay.map(splitDay);
  const timed = split.map((d) => d.timed);
  const allDay = byDay.map((list) => list.filter((m) => !m.startLabel));
  const early = split.map((d) => d.early);
  const late = split.map((d) => d.late);

  // Franja de eventos sin lugar en la grilla: todo el día, antes de las 9 o después de las 18.
  const strip = (label: string, lists: CalMeeting[][], kind: string) =>
    lists.some((l) => l.length > 0) && (
      <div className={`ws-row ws-strip ${kind}`}>
        <span className="ws-gutter">{label}</span>
        {lists.map((list, i) => (
          <div key={days[i]} className={`ws-cell${days[i] < today ? " past" : ""}`}>
            {list.map((m) => (
              <button key={m.key} type="button" className={evClass(m)} onClick={() => onOpen(m.key)} title={eventTitle(m)}>
                <span className="nd-ev-txt">
                  {m.client && <Icon name="calendar" size={12} strokeWidth={2.2} />}
                  {m.startLabel && <b>{m.startLabel}</b>} {m.client ?? m.title}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    );
  const from = DAY_START;
  const to = DAY_END;
  const hours = Array.from({ length: to - from }, (_, i) => from + i);
  const y = (minutes: number) => ((minutes - from * 60) / 60) * HOUR_PX;

  return (
    <div
      className="nd-cal ws"
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
        go(dx < 0 ? 1 : -1);
      }}
    >
      <div className="nd-cal-head">
        <div className="nd-cal-title ws-title" aria-live="polite">
          {weekLabel(monday)}
        </div>
        <div className="nd-cal-nav">
          <button type="button" className="nd-cal-btn" onClick={() => go(-1)} disabled={monday <= first} aria-label="Semana anterior">
            <Icon name="chevron" size={15} className="flip" />
          </button>
          <button type="button" className="nd-cal-btn today" onClick={() => setMonday(thisWeek)} disabled={monday === thisWeek}>
            Hoy
          </button>
          <button type="button" className="nd-cal-btn" onClick={() => go(1)} disabled={monday >= last} aria-label="Semana siguiente">
            <Icon name="chevron" size={15} />
          </button>
        </div>
      </div>

      {/* key por semana: remonta la grilla y dispara la animación de entrada. */}
      <div key={monday} className="ws-grid">
        <div className="ws-row ws-head">
          <span className="ws-gutter" />
          {days.map((d, i) => (
            <div key={d} className={["ws-day", d === today && "today", d < today && "past"].filter(Boolean).join(" ")}>
              <small>{WEEKDAYS[i]}</small>
              <span className="nd-cal-num">{utc(d).getUTCDate()}</span>
            </div>
          ))}
        </div>

        {strip("Todo el día", allDay, "allday")}
        {strip("Antes de las 9", early, "early")}

        <div className="ws-row ws-body" style={{ height: hours.length * HOUR_PX }}>
          <div className="ws-gutter ws-hours" aria-hidden>
            {hours.map((h) => (
              <span key={h} style={{ top: (h - from) * HOUR_PX }}>
                {`${String(h).padStart(2, "0")}:00`}
              </span>
            ))}
          </div>
          {days.map((d, i) => (
            <div
              key={d}
              className={["ws-col", d === today && "today", d < today && "past"].filter(Boolean).join(" ")}
              style={{ backgroundSize: `100% ${HOUR_PX}px` }}
            >
              {placeDay(timed[i]).map(({ m, start, end, col, cols }) => {
                // Alto exacto de lo que dura, menos un px de aire abajo para que dos
                // seguidas (10:50–11:00 y 11:00–12:00) no se toquen.
                const height = Math.max(y(end) - y(start) - 1, MIN_PX);
                return (
                  <button
                    key={m.key}
                    type="button"
                    className={`${evClass(m)}${height < 22 ? " tiny" : height < 44 ? " short" : ""}`}
                    style={{
                      top: y(start) + 1,
                      height,
                      left: `calc(${(col / cols) * 100}% + 4px)`,
                      width: `calc(${100 / cols}% - 8px)`,
                    }}
                    onClick={() => onOpen(m.key)}
                    title={eventTitle(m)}
                  >
                    <span className="nd-ev-txt">
                      {m.client && <Icon name="calendar" size={12} strokeWidth={2.2} />}
                      <b>{m.startLabel}</b> {m.client ?? m.title}
                    </span>
                    <span className="nd-ev-txt ws-sub">
                      {m.client ? `${m.title} · ` : ""}hasta {m.endLabel}
                    </span>
                  </button>
                );
              })}
              {/* Línea de la hora actual, solo en el día de hoy y dentro del horario visible. */}
              {now && now.day === d && now.minutes >= from * 60 && now.minutes <= to * 60 && (
                <span className="ws-now" style={{ top: y(now.minutes) }} aria-hidden />
              )}
            </div>
          ))}
        </div>

        {strip("Después de las 18", late, "late")}
      </div>
    </div>
  );
}
