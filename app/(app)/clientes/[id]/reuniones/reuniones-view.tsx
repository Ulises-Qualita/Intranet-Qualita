import { SyncStatus } from "@/components/sync-status";
import { Topbar } from "@/components/topbar";
import { Card, EmptyState } from "@/components/ui";
import { attendeeName, calendarConfigured, getClientMeetings, meetingTime, type Meeting } from "@/lib/calendar";
import { type Client, getTasksResult, getTeam, isOpenTask } from "@/lib/data";
import { relativeTime, shortDate, todayISO } from "@/lib/format";
import { getMeetingNotes } from "@/lib/meeting-notes";
import { type CalMeeting, type MeetingPrep, MeetingsCalendar } from "./meetings-calendar";

const PRIORITY_RANK = { alta: 0, media: 1, baja: 2 };

const TZ = "America/Argentina/Buenos_Aires";
// Misma ventana que lee lib/calendar.ts.
const PAST_DAYS = 90;
const FUTURE_DAYS = 60;

const hour = (iso: string) =>
  new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ }).format(new Date(iso));

// Un evento de día completo trae solo la fecha (YYYY-MM-DD), sin zona horaria.
const localDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso));

// Meses (YYYY-MM) que cubre la ventana de Calendar, para navegar el calendario.
function windowMonths(today: string) {
  const at = (days: number) => new Date(Date.parse(`${today}T12:00:00Z`) + days * 86_400_000);
  const from = at(-PAST_DAYS);
  const last = at(FUTURE_DAYS).toISOString().slice(0, 7);
  const months: string[] = [];
  for (let i = 0; months.at(-1) !== last && i < 12; i++) {
    months.push(new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + i, 1)).toISOString().slice(0, 7));
  }
  return months;
}

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

  const [{ upcoming, past, error }, notes, team, taskData] = await Promise.all([
    getClientMeetings(client.name),
    getMeetingNotes(client.id),
    // Fotos y nombres del equipo para los participantes, y el "Editado por…".
    // getTeam usa service_role: acá solo sale nombre y foto de quien está en la reunión.
    getTeam(),
    // Nunca tira: si Notion falla devuelve las propias y el motivo.
    internal && withTasks ? getTasksResult() : null,
  ]);
  const names = new Map(team.map((m) => [m.id, m.name]));
  const byEmail = new Map(team.filter((m) => m.email).map((m) => [m.email!.toLowerCase(), m]));
  // Participantes con la foto de Google de los del equipo (se guarda al iniciar
  // sesión). La gente de afuera no tiene foto accesible: quedan las iniciales.
  const people = (m: Meeting) =>
    m.attendees.map((a) => {
      const member = byEmail.get(a.email.toLowerCase());
      return { name: member?.name ?? attendeeName(a), avatarUrl: member?.avatarUrl ?? null };
    });
  const now = new Date().toISOString();
  const today = todayISO();

  // Cuánto falta para una próxima: "en 45 min", "en 3 h", "mañana", "en 5 días".
  // Se calcula acá y no en el navegador para que el server y el cliente coincidan.
  const startsIn = (m: Meeting, day: string, status: CalMeeting["status"]) => {
    if (status === "live") return "Ahora";
    if (status === "past") return null;
    const minutes = Math.round((Date.parse(m.start) - Date.parse(now)) / 60_000);
    if (day === today) return m.allDay ? "hoy" : minutes < 60 ? `en ${Math.max(1, minutes)} min` : `en ${Math.round(minutes / 60)} h`;
    const days = Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
    return days === 1 ? "mañana" : `en ${days} días`;
  };

  // "Editado por Ana hace 2 días": solo para el equipo.
  const noteMeta = (key: string) => {
    const note = notes.byKey[key];
    if (!internal || !note) return null;
    const author = note.updatedBy ? names.get(note.updatedBy) : null;
    return `Editado${author ? ` por ${author}` : ""} ${relativeTime(note.updatedAt)}`;
  };

  const toCal = (m: Meeting, status: CalMeeting["status"]): CalMeeting => ({
    key: m.key,
    title: m.reason ?? "Reunión",
    day: m.allDay ? m.start.slice(0, 10) : localDay(m.start),
    startsIn: startsIn(m, m.allDay ? m.start.slice(0, 10) : localDay(m.start), status),
    // Vacíos en un evento de todo el día.
    startLabel: m.allDay ? "" : hour(m.start),
    endLabel: m.allDay ? "" : hour(m.end),
    attendees: people(m),
    meetUrl: m.meetUrl,
    status,
    notes: notes.byKey[m.key]?.notes ?? null,
    notesMeta: noteMeta(m.key),
  });
  // En orden cronológico: las próximas se agrupan por semana respetando este orden.
  const calendar = [
    ...[...past].reverse().map((m) => toCal(m, "past")),
    ...upcoming.map((m) => toCal(m, !m.allDay && meetingTime(m.start) <= Date.parse(now) ? "live" : "upcoming")),
  ];

  // Tareas a cerrar antes de cada reunión que viene (solo equipo con el área
  // Tareas): las abiertas del cliente con vencimiento. Van todas y la card de
  // cada reunión, al tocarla, se queda con las que vencen ese día o antes. Las
  // abiertas sin vencimiento no entran (no se sabe para qué reunión son): se cuentan.
  const members = new Map(team.map((m) => [m.id, m]));
  const openTasks = (taskData?.tasks ?? []).filter((t) => t.client_id === client.id && isOpenTask(t));
  const prep: MeetingPrep | null = taskData && {
    tasks: openTasks
      .filter((t) => t.due_date)
      .sort((a, b) => a.due_date!.localeCompare(b.due_date!) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
      .map((t) => {
        const due = t.due_date!;
        const assignee = t.assignee_id ? members.get(t.assignee_id) : undefined;
        return {
          id: t.id,
          title: t.title,
          url: t.url,
          priority: t.priority,
          status: t.status,
          due,
          dueLabel: `Deadline: ${due === today ? "hoy" : shortDate(due)}`,
          late: due <= today,
          assignee: assignee ? { name: assignee.name, avatarUrl: assignee.avatarUrl } : null,
        };
      }),
    undated: openTasks.filter((t) => !t.due_date).length,
    error: taskData.notionError,
    connectHref: client.conn.notion ? null : `/clientes/${client.slug}/notion/conectar`,
  };

  return (
    <>
      {!internal && <Topbar crumb={client.name} title={title} />}
      <section className="view">
        <SyncStatus source="Google Calendar" live error={error} internal={internal} />
        {internal && notes.missingTable && (
          <p className="form-error">Falta correr docs/sql/2026-09-30-reuniones-notas.sql en Supabase para guardar descripciones.</p>
        )}
        <div className="card pad-lg">
          {/* Las pasadas se ven tocando su día; ahí el equipo escribe la descripción. */}
          <MeetingsCalendar
            meetings={calendar}
            months={windowMonths(today)}
            today={today}
            editSlug={internal && !notes.missingTable ? client.slug : null}
            prep={prep}
          />
        </div>
      </section>
    </>
  );
}
