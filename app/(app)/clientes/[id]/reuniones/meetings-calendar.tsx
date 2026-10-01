"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { UserAvatar } from "@/components/user-avatar";
import { MeetingNote } from "./meeting-note";

// Reunión ya lista para dibujar: fechas y horas formateadas en el server, en
// hora de Argentina (reuniones-view.tsx).
export type CalMeeting = {
  key: string;
  title: string;
  // Día local (YYYY-MM-DD) en que cae.
  day: string;
  // "en 45 min", "mañana"…; null en las pasadas.
  startsIn: string | null;
  // "10:00" y "11:00"; vacíos si es de todo el día.
  startLabel: string;
  endLabel: string;
  // Foto de Google solo para los del equipo; el resto, iniciales.
  attendees: { name: string; avatarUrl: string | null }[];
  meetUrl: string | null;
  status: "past" | "live" | "upcoming";
  notes: string | null;
  // "Editado por Ana hace 2 días"; solo para el equipo.
  notesMeta: string | null;
};

const WEEKDAYS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
// Reuniones escritas por celda; el resto va como "+N más".
const PER_DAY = 2;
const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("es-AR", { ...opts, timeZone: "UTC" });
const monthLabel = fmt({ month: "long", year: "numeric" });
const dayLabel = fmt({ weekday: "long", day: "numeric", month: "long" });
const weekdayShort = fmt({ weekday: "short" });
const monthShort = fmt({ month: "short" });
const utc = (iso: string) => new Date(`${iso}T12:00:00Z`);
const addDays = (iso: string, n: number) => new Date(utc(iso).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const clean = (s: string) => s.replace(".", "");

// "2026-10" → celdas de lunes a domingo, solo las semanas justas (4 a 6).
function monthGrid(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const inMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = Math.ceil((lead + inMonth) / 7) * 7;
  const days = Array.from({ length: cells }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1, 1 - lead + i));
    return { iso: d.toISOString().slice(0, 10), day: d.getUTCDate(), inMonth: d.getUTCMonth() === m - 1 };
  });
  return { label: monthLabel.format(first), days };
}

function dayTitle(iso: string, today: string) {
  if (iso === today) return "Hoy";
  if (iso === addDays(today, 1)) return "Mañana";
  if (iso === addDays(today, -1)) return "Ayer";
  const text = dayLabel.format(utc(iso));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const plural = (n: number) => `${n} ${n === 1 ? "reunión" : "reuniones"}`;

// Lunes de la semana de un día.
const weekOf = (iso: string) => addDays(iso, -((utc(iso).getUTCDay() + 6) % 7));
const weekStartLabel = fmt({ day: "numeric", month: "long" });

function weekTitle(monday: string, today: string) {
  const current = weekOf(today);
  if (monday === current) return "Esta semana";
  if (monday === addDays(current, 7)) return "Próxima semana";
  return `Semana del ${weekStartLabel.format(utc(monday))}`;
}

// Calendario de reuniones con el cliente: el mes a la izquierda, con cada
// reunión escrita en su día, y a la derecha las próximas como cards. Al tocar
// un día, la derecha muestra las de ese día (las pasadas con su descripción).
// Los meses posibles son los de la ventana que se lee de Calendar.
// `editSlug`: el equipo puede escribir la descripción de las pasadas (null = solo lectura).
export function MeetingsCalendar({
  meetings,
  months,
  today,
  editSlug,
}: {
  meetings: CalMeeting[];
  months: string[];
  today: string;
  editSlug: string | null;
}) {
  const initial = Math.max(0, months.indexOf(today.slice(0, 7)));
  const [index, setIndex] = useState(initial);
  const [picked, setPicked] = useState<string | null>(null);
  const ym = months[index];
  const { label, days } = useMemo(() => monthGrid(ym), [ym]);

  const byDay = useMemo(() => {
    const map = new Map<string, CalMeeting[]>();
    for (const m of meetings) map.set(m.day, [...(map.get(m.day) ?? []), m]);
    return map;
  }, [meetings]);

  const upcoming = meetings.filter((m) => m.status !== "past");
  const shown = picked ? (byDay.get(picked) ?? []) : upcoming;
  // Las próximas, separadas por semana; un día elegido va sin separar.
  const weeks: [string | null, CalMeeting[]][] = [];
  if (picked) weeks.push([null, shown]);
  else
    for (const m of upcoming) {
      const monday = weekOf(m.day);
      const last = weeks.at(-1);
      if (last?.[0] === monday) last[1].push(m);
      else weeks.push([monday, [m]]);
    }

  const go = (i: number) => setIndex(Math.min(months.length - 1, Math.max(0, i)));
  const backToToday = () => {
    setIndex(initial);
    setPicked(null);
  };

  return (
    <div className="mcal">
      <div className="mcal-month">
        <div className="mcal-head">
          <h3 aria-live="polite">{label}</h3>
          <div className="mcal-nav">
            <button type="button" className="mcal-today" onClick={backToToday} disabled={index === initial && !picked}>
              Hoy
            </button>
            <button type="button" className="mcal-arrow" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Mes anterior">
              <Icon name="chevron" size={16} className="flip" />
            </button>
            <button
              type="button"
              className="mcal-arrow"
              onClick={() => go(index + 1)}
              disabled={index === months.length - 1}
              aria-label="Mes siguiente"
            >
              <Icon name="chevron" size={16} />
            </button>
          </div>
        </div>

        <div key={ym} className="mcal-grid">
          {WEEKDAYS.map((d) => (
            <span key={d} className="mcal-wd" aria-hidden>
              {d}
            </span>
          ))}
          {days.map((d) => {
            const list = byDay.get(d.iso) ?? [];
            const classes = [
              "mcal-d",
              !d.inMonth && "out",
              d.iso < today && "gone",
              d.iso === today && "today",
              picked === d.iso && "on",
            ].filter(Boolean);
            return (
              <button
                key={d.iso}
                type="button"
                className={classes.join(" ")}
                onClick={() => setPicked(picked === d.iso ? null : d.iso)}
                aria-pressed={picked === d.iso}
                aria-label={`${dayTitle(d.iso, today)}${list.length ? `, ${plural(list.length)}` : ""}`}
              >
                <span className="mcal-n">{d.day}</span>
                {list.slice(0, PER_DAY).map((m) => (
                  <span key={m.key} className={`mcal-ev ${m.status}`} aria-hidden>
                    {m.startLabel && <b>{m.startLabel}</b>}
                    <span>{m.title}</span>
                  </span>
                ))}
                {list.length > PER_DAY && (
                  <span className="mcal-more" aria-hidden>
                    +{list.length - PER_DAY} más
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mcal-side">
        <div className="mcal-head">
          <div className="mcal-side-title">
            <h3>{picked ? dayTitle(picked, today) : "Próximas reuniones"}</h3>
            <span>{shown.length ? plural(shown.length) : picked ? "Sin reuniones" : "Nada agendado"}</span>
          </div>
          {picked && (
            <button type="button" className="mcal-today" onClick={() => setPicked(null)}>
              Ver próximas
            </button>
          )}
        </div>

        <div className="mcal-list">
          {shown.length === 0 ? (
            <div className="mcal-empty">
              <Icon name="calendar" size={22} />
              <p>{picked ? "No hubo ni hay reuniones este día." : "No hay reuniones agendadas con este cliente."}</p>
            </div>
          ) : (
            weeks.map(([monday, list]) => (
              <section key={monday ?? "day"} className="mcal-week">
                {monday && (
                  <h4>
                    <span>{weekTitle(monday, today)}</span>
                    <small>{plural(list.length)}</small>
                  </h4>
                )}
                {list.map((m) => (
                  <MeetingCard key={m.key} m={m} editSlug={editSlug} />
                ))}
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function MeetingCard({ m, editSlug }: { m: CalMeeting; editSlug: string | null }) {
  const date = utc(m.day);
  return (
    <article className={`mcard ${m.status}`}>
      <div className="mcard-date" aria-hidden>
        <span>{clean(weekdayShort.format(date))}</span>
        <b>{date.getUTCDate()}</b>
        <span>{clean(monthShort.format(date))}</span>
      </div>

      <div className="mcard-body">
        <div className="mcard-top">
          <h4>{m.title}</h4>
          {m.status === "live" ? (
            <span className="mcard-badge live">En curso</span>
          ) : (
            m.startsIn && <span className="mcard-badge">{m.startsIn}</span>
          )}
        </div>
        <p className="mcard-time">
          <Icon name="clock" size={14} strokeWidth={2} />
          {m.startLabel ? `${m.startLabel} – ${m.endLabel} hs` : "Todo el día"}
        </p>
        {m.attendees.length > 0 && (
          <div className="mcard-people">
            <span className="mcard-avatars" aria-hidden>
              {m.attendees.slice(0, 4).map((a, i) => (
                <UserAvatar key={`${a.name}-${i}`} className="mcard-av" name={a.name} avatarUrl={a.avatarUrl} />
              ))}
              {m.attendees.length > 4 && <i className="more">+{m.attendees.length - 4}</i>}
            </span>
            <span className="mcard-names">{m.attendees.map((a) => a.name).join(", ")}</span>
          </div>
        )}
        {/* Descripción de una pasada: el equipo la escribe acá; el cliente solo la lee. */}
        {m.status === "past" &&
          (editSlug ? (
            <MeetingNote clientSlug={editSlug} meetingKey={m.key} notes={m.notes} meta={m.notesMeta} />
          ) : (
            m.notes && <p className="mcard-notes">{m.notes}</p>
          ))}
      </div>

      {m.status !== "past" && m.meetUrl && (
        <a className="mcard-join" href={m.meetUrl} target="_blank" rel="noopener noreferrer" aria-label={`Unirse a ${m.title}`}>
          <Icon name="media" size={15} strokeWidth={2} />
          Unirse
        </a>
      )}
    </article>
  );
}
