import { SyncStatus } from "@/components/sync-status";
import { Topbar } from "@/components/topbar";
import { Card, EmptyState } from "@/components/ui";
import { buildMeetings } from "@/app/(app)/clientes/[id]/reuniones/build";
import { getSession } from "@/lib/auth";
import { canAccess } from "@/lib/auth-shared";
import { calendarConfigured, getMemberMeetings, normalizeName } from "@/lib/calendar";
import { getClients, getTasksResult, getTeam } from "@/lib/data";
import { getMeetingNotes } from "@/lib/meeting-notes";
import { TeamMeetings } from "./team-meetings";

// Reuniones del sidebar: todo el calendario de Google de quien entra (las
// reuniones con clientes, "<Cliente> & Qualita <motivo>", y el resto): la semana
// por horario con el estilo del calendario del portal y las próximas debajo
// (team-meetings.tsx), con el nombre del cliente en cada reunión. Como el foro, no es de un área: son las reuniones de su propio
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
  const { calendar, prep, today } = buildMeetings({
    meetings,
    clientOf: (m) => (m.clientName ? (byName.get(normalizeName(m.clientName)) ?? null) : null),
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
        <TeamMeetings meetings={calendar} today={today} prep={prep} />
      </section>
    </>
  );
}
