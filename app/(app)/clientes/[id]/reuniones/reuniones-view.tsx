import { Topbar } from "@/components/topbar";
import { Card, EmptyState, Pill } from "@/components/ui";
import { calendarConfigured, getClientMeetings, type Meeting } from "@/lib/calendar";
import type { Client } from "@/lib/data";

const TZ = "America/Argentina/Buenos_Aires";

// Un evento de día completo trae solo la fecha: se formatea en UTC para que no
// corra al día anterior.
const dayPart = (m: Meeting, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("es-AR", { ...opts, timeZone: m.allDay ? "UTC" : TZ })
    .format(new Date(m.allDay ? `${m.start}T00:00:00Z` : m.start))
    .replace(".", "");

const hour = (iso: string) =>
  new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ }).format(new Date(iso));

const localDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso));

function attendeesLabel(m: Meeting) {
  const names = m.attendees.map((a) => a.name ?? a.email.split("@")[0]);
  if (names.length === 0) return null;
  if (names.length <= 3) return `Con ${names.join(", ")}`;
  return `Con ${names.slice(0, 2).join(", ")} y ${names.length - 2} más`;
}

function MeetingRow({ m, upcoming }: { m: Meeting; upcoming: boolean }) {
  const now = new Date().toISOString();
  const live = upcoming && !m.allDay && m.start <= now;
  const today = !m.allDay && localDay(m.start) === localDay(now);
  const when = m.allDay ? "Todo el día" : `${hour(m.start)} – ${hour(m.end)}`;
  const who = attendeesLabel(m);

  return (
    <div className="lead-row meet-row">
      <div className="meet-date">
        <span>{dayPart(m, { weekday: "short" })}</span>
        <b>{dayPart(m, { day: "numeric" })}</b>
        <span>{dayPart(m, { month: "short" })}</span>
      </div>
      <div className="info">
        <b>{m.reason ?? "Reunión"}</b>
        <span>{who ? `${when} · ${who}` : when}</span>
      </div>
      {live ? <Pill variant="activo">En curso</Pill> : upcoming && today && <Pill variant="neg">Hoy</Pill>}
      {upcoming && m.meetUrl && (
        <a className="meet-join" href={m.meetUrl} target="_blank" rel="noopener noreferrer">
          Unirse
        </a>
      )}
    </div>
  );
}

// Pestaña Reuniones: las reuniones de Google Calendar del equipo con este
// cliente, reconocidas por la nomenclatura "<Cliente> & Qualita <motivo>". La
// comparten el panel interno y la cuenta del cliente: quien la llama ya validó
// el acceso. `internal` agrega las pistas para configurar.
export async function ReunionesView({ client, internal }: { client: Client; internal: boolean }) {
  const title = "Reuniones";

  if (!calendarConfigured()) {
    return (
      <>
        <Topbar crumb={client.name} title={title} />
        <section className="view">
          <Card title={title}>
            <EmptyState label="No conectado">
              {internal
                ? "Google Calendar todavía no está configurado (cuenta de servicio del Workspace)."
                : "Todavía no hay reuniones para mostrar."}
            </EmptyState>
          </Card>
        </section>
      </>
    );
  }

  const { upcoming, past, error } = await getClientMeetings(client.name);
  const convention = `Se muestran las reuniones cuyo nombre empieza con «${client.name} & Qualita».`;

  return (
    <>
      <Topbar crumb={client.name} title={title} />
      <section className="view">
        {error && (
          <p className="form-msg login-err">
            {internal ? `No se pudo leer Google Calendar: ${error}` : "No se pudieron cargar las reuniones. Probá más tarde."}
          </p>
        )}
        <div className="view-actions">
          <span className="muted">{internal ? convention : "Tus reuniones con el equipo de Qualita."}</span>
        </div>
        <div className="grid g2">
          <Card title="Próximas" hint="Próximos 60 días">
            {upcoming.length === 0 ? (
              <EmptyState label="Sin reuniones">No hay reuniones agendadas.</EmptyState>
            ) : (
              upcoming.map((m) => <MeetingRow key={m.key} m={m} upcoming />)
            )}
          </Card>
          <Card title="Anteriores" hint="Últimos 90 días">
            {past.length === 0 ? (
              <EmptyState label="Sin reuniones">No hubo reuniones en los últimos 90 días.</EmptyState>
            ) : (
              past.map((m) => <MeetingRow key={m.key} m={m} upcoming={false} />)
            )}
          </Card>
        </div>
      </section>
    </>
  );
}
