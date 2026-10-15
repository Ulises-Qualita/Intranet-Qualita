import { SyncStatus } from "@/components/sync-status";
import { Topbar } from "@/components/topbar";
import { Card, EmptyState } from "@/components/ui";
import { buildMeetings } from "@/app/(app)/clientes/[id]/reuniones/build";
import { MeetingsCalendar } from "@/app/(app)/clientes/[id]/reuniones/meetings-calendar";
import { getSession } from "@/lib/auth";
import { canAccess } from "@/lib/auth-shared";
import { calendarConfigured, getMemberMeetings, normalizeName } from "@/lib/calendar";
import { getClients, getTasksResult, getTeam } from "@/lib/data";
import { getMeetingNotes } from "@/lib/meeting-notes";

// Reuniones del sidebar: las reuniones con clientes ("<Cliente> & Qualita
// <motivo>") en las que participa quien entra, de todos los clientes. Mismo
// calendario que la solapa Reuniones de cada cliente, con el nombre del cliente
// en cada reunión. Como el foro, no es de un área: son las reuniones de su propio
// calendario. Las descripciones se editan con el área Clientes y las tareas
// para la próxima reunión se ven con el área Tareas, igual que en la solapa.
export default async function ReunionesPage() {
  const session = await getSession();
  const title = "Reuniones";
  if (!session?.profile?.active) {
    return (
      <>
        <Topbar crumb="Qualita" title={title} />
        <section className="view">
          <Card title={title}>
            <EmptyState label="Sin acceso">Tu cuenta todavía no está habilitada en la intranet.</EmptyState>
          </Card>
        </section>
      </>
    );
  }

  if (!calendarConfigured()) {
    return (
      <>
        <Topbar crumb="Qualita" title={title} />
        <section className="view">
          <Card title={title}>
            <EmptyState label="No conectado">Google Calendar todavía no está configurado (cuenta de servicio del Workspace).</EmptyState>
          </Card>
        </section>
      </>
    );
  }

  const seesClients = canAccess(session.profile, "clientes");
  const [meetings, clients, team, taskData] = await Promise.all([
    getMemberMeetings(session.user.email),
    // Los clientes que ve (RLS): sin el área, las reuniones quedan sin notas ni tareas.
    seesClients ? getClients() : [],
    getTeam(),
    // Nunca tira: si Notion falla devuelve las propias y el motivo.
    canAccess(session.profile, "tareas") ? getTasksResult() : null,
  ]);
  const byName = new Map(clients.map((c) => [normalizeName(c.name), c]));
  const notes = await getMeetingNotes(clients.map((c) => c.id));
  const { calendar, prep, today, months } = buildMeetings({
    meetings,
    clientOf: (m) => byName.get(normalizeName(m.clientName)) ?? null,
    notes,
    team,
    internal: true,
    canEdit: seesClients && !notes.missingTable,
    showClient: true,
    taskData,
  });

  return (
    <>
      <Topbar crumb="Qualita" title={title} />
      <section className="view">
        <SyncStatus source="Google Calendar" live error={meetings.error} internal />
        <div className="card pad-lg">
          {/* Las pasadas se ven tocando su día; ahí se escribe la descripción. */}
          <MeetingsCalendar
            meetings={calendar}
            months={months}
            today={today}
            prep={prep}
            emptyText="No tenés reuniones con clientes agendadas."
            view="week"
          />
        </div>
      </section>
    </>
  );
}
