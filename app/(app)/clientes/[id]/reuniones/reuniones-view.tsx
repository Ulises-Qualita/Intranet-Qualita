import { SyncStatus } from "@/components/sync-status";
import { Topbar } from "@/components/topbar";
import { Card, EmptyState } from "@/components/ui";
import { calendarConfigured, getClientMeetings } from "@/lib/calendar";
import { type Client, getTasksResult, getTeam } from "@/lib/data";
import { getMeetingNotes } from "@/lib/meeting-notes";
import { buildMeetings } from "./build";
import { MeetingsCalendar } from "./meetings-calendar";

// Pestaña Reuniones: las reuniones de Google Calendar del equipo con este
// cliente, reconocidas por la nomenclatura "<Cliente> & Qualita <motivo>".
// El mes a la izquierda y las próximas a la derecha; tocando un día pasado se
// ven sus reuniones con la descripción que escribe el equipo
// (intranet_meeting_notes) y que la cuenta del cliente lee.
// La comparten el panel interno y la cuenta del cliente: quien la llama ya validó
// el acceso. `internal` agrega la edición y las pistas para configurar.
// `withTasks` (solo equipo con el área Tareas): al tocar una reunión que viene,
// su card muestra lo que hay que cerrar antes.
export async function ReunionesView({
  client,
  internal,
  withTasks = false,
}: {
  client: Client;
  internal: boolean;
  withTasks?: boolean;
}) {
  const title = "Reuniones";

  if (!calendarConfigured()) {
    return (
      <>
        {!internal && <Topbar crumb={client.name} title={title} />}
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

  const [meetings, notes, team, taskData] = await Promise.all([
    getClientMeetings(client.name),
    getMeetingNotes(client.id),
    // getTeam usa service_role: acá solo sale nombre y foto de quien está en la reunión.
    getTeam(),
    // Nunca tira: si Notion falla devuelve las propias y el motivo.
    internal && withTasks ? getTasksResult() : null,
  ]);
  const { calendar, prep, today, months } = buildMeetings({
    meetings,
    clientOf: () => client,
    notes,
    team,
    internal,
    canEdit: internal && !notes.missingTable,
    taskData,
  });

  return (
    <>
      {!internal && <Topbar crumb={client.name} title={title} />}
      <section className="view">
        <SyncStatus source="Google Calendar" live error={meetings.error} internal={internal} />
        {internal && notes.missingTable && (
          <p className="form-error">Falta correr docs/sql/2026-09-30-reuniones-notas.sql en Supabase para guardar descripciones.</p>
        )}
        <div className="card pad-lg">
          {/* Las pasadas se ven tocando su día; ahí el equipo escribe la descripción. */}
          <MeetingsCalendar
            meetings={calendar}
            months={months}
            today={today}
            prep={prep}
          />
        </div>
      </section>
    </>
  );
}
