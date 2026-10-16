"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import {
  type CalMeeting,
  type MeetingPrep,
  MeetingCard,
  plural,
  weekOf,
  weekTitle,
} from "@/app/(app)/clientes/[id]/reuniones/meetings-calendar";
import { WeekSchedule } from "./week-schedule";

// Pantalla Reuniones del sidebar: la semana con las horas en filas y el estilo
// del calendario del portal (week-schedule.tsx), a todo el ancho, y debajo las próximas reuniones como cards
// separadas por semana. Tocar una reunión (en el calendario o en la lista) abre
// su card en un diálogo: con las tareas a cerrar antes si viene, o con la
// descripción si ya pasó.
export function TeamMeetings({
  meetings,
  today,
  prep,
}: {
  meetings: CalMeeting[];
  today: string;
  prep: MeetingPrep | null;
}) {
  // Por clave y no la reunión: al guardar una descripción la página se refresca y
  // el diálogo tiene que mostrar el texto nuevo.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const open = openKey ? (meetings.find((m) => m.key === openKey) ?? null) : null;
  const dialog = useRef<HTMLDialogElement>(null);
  const show = (key: string) => setOpenKey(key);
  const close = () => dialog.current?.close();
  // El diálogo se abre cuando hay una reunión elegida (y existe en la lista).
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
  }, [open]);

  // Las próximas de esta semana y la que viene (pedido), separadas por semana; las
  // listas llegan en orden cronológico. Las más lejanas se ven en el calendario.
  const thisWeek = weekOf(today);
  const nextWeek = weekOf(new Date(Date.parse(`${thisWeek}T12:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10));
  const weeks: [string, CalMeeting[]][] = [];
  for (const m of meetings.filter((x) => x.status !== "past" && weekOf(x.day) <= nextWeek)) {
    const monday = weekOf(m.day);
    const last = weeks.at(-1);
    if (last?.[0] === monday) last[1].push(m);
    else weeks.push([monday, [m]]);
  }

  return (
    // Con la estética del portal del cliente: luces de marca de fondo (.pt) y
    // cada bloque en vidrio esmerilado (.pt-glass).
    <div className="pt tm">
      <section className="pt-glass pt-pad pt-cal">
        <WeekSchedule meetings={meetings} today={today} onOpen={show} />
      </section>

      <section className="pt-glass pt-pad tm-upcoming">
        <div className="tm-upcoming-head">
          <h3>Próximas reuniones</h3>
          <span>{weeks.length ? plural(weeks.reduce((n, [, l]) => n + l.length, 0)) : "Nada agendado"}</span>
        </div>
        {weeks.length === 0 ? (
          <div className="mcal-empty">
            <Icon name="calendar" size={22} />
            <p>No tenés reuniones agendadas para esta semana ni la próxima.</p>
          </div>
        ) : (
          weeks.map(([monday, list]) => (
            <div key={monday} className="tm-week">
              <h4>
                <span>{weekTitle(monday, today)}</span>
                <small>{plural(list.length)}</small>
              </h4>
              <div className="tm-cards">
                {list.map((m) => (
                  <MeetingCard key={m.key} m={m} prep={null} onOpen={() => show(m.key)} />
                ))}
              </div>
            </div>
          ))
        )}
      </section>

      <dialog
        ref={dialog}
        className="modal"
        aria-label={open ? `${open.client ?? ""} ${open.title}` : "Reunión"}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
        onClose={() => setOpenKey(null)}
      >
        {open && (
          <div className="modal-card tm-detail">
            <div className="modal-head">
              {/* Arriba a la izquierda: el cliente y, debajo, qué es. */}
              <div className="tm-detail-kind">
                {open.client && <b>{open.client}</b>}
                <span>{open.status === "past" ? "Reunión realizada" : "Reunión"}</span>
              </div>
              <button type="button" className="modal-close" onClick={close} aria-label="Cerrar">
                ×
              </button>
            </div>
            {/* Las tareas solo en las que vienen; las pasadas, con su descripción. */}
            <MeetingCard m={open} prep={open.status !== "past" ? prep : null} detail />
          </div>
        )}
      </dialog>
    </div>
  );
}
