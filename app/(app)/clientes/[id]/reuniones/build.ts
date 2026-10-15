import { attendeeName, meetingTime, type ClientMeetings, type Meeting } from "@/lib/calendar";
import { type Client, type TasksResult, type TeamMember, isOpenTask } from "@/lib/data";
import { relativeTime, shortDate, todayISO } from "@/lib/format";
import type { MeetingNotes } from "@/lib/meeting-notes";
import type { CalMeeting, MeetingPrep } from "./meetings-calendar";

// Arma lo que dibuja MeetingsCalendar. Lo comparten la solapa Reuniones del
// cliente (reuniones-view.tsx) y la pantalla Reuniones del sidebar
// (app/(app)/reuniones), que junta las de todos los clientes del miembro.

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
export function windowMonths(today: string) {
  const at = (days: number) => new Date(Date.parse(`${today}T12:00:00Z`) + days * 86_400_000);
  const from = at(-PAST_DAYS);
  const last = at(FUTURE_DAYS).toISOString().slice(0, 7);
  const months: string[] = [];
  for (let i = 0; months.at(-1) !== last && i < 12; i++) {
    months.push(new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + i, 1)).toISOString().slice(0, 7));
  }
  return months;
}

export function buildMeetings({
  meetings,
  clientOf,
  notes,
  team,
  internal,
  canEdit,
  showClient = false,
  taskData = null,
}: {
  meetings: ClientMeetings;
  // Cliente de cada reunión; null si el usuario no lo ve (sin notas ni tareas).
  clientOf: (m: Meeting) => Client | null;
  notes: MeetingNotes;
  // Fotos y nombres del equipo para los participantes, y el "Editado por…".
  team: TeamMember[];
  internal: boolean;
  // El equipo escribe la descripción de las pasadas.
  canEdit: boolean;
  // En la pantalla del sidebar cada reunión dice de qué cliente es.
  showClient?: boolean;
  // Solo el equipo con el área Tareas: lo que hay que cerrar antes de cada reunión.
  taskData?: TasksResult | null;
}) {
  const { upcoming, past } = meetings;
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

  const toCal = (m: Meeting, status: CalMeeting["status"]): CalMeeting => {
    const day = m.allDay ? m.start.slice(0, 10) : localDay(m.start);
    const client = clientOf(m);
    return {
      key: m.key,
      title: m.reason ?? "Reunión",
      client: showClient ? (client?.name ?? m.clientName) : null,
      clientId: client?.id ?? null,
      day,
      startsIn: startsIn(m, day, status),
      // Vacíos en un evento de todo el día.
      startLabel: m.allDay ? "" : hour(m.start),
      endLabel: m.allDay ? "" : hour(m.end),
      attendees: people(m),
      meetUrl: m.meetUrl,
      status,
      notes: notes.byKey[m.key]?.notes ?? null,
      notesMeta: noteMeta(m.key),
      editSlug: canEdit && client ? client.slug : null,
    };
  };
  // En orden cronológico: las próximas se agrupan por semana respetando este orden.
  const calendar = [
    ...[...past].reverse().map((m) => toCal(m, "past")),
    ...upcoming.map((m) => toCal(m, !m.allDay && meetingTime(m.start) <= Date.parse(now) ? "live" : "upcoming")),
  ];

  // Tareas a cerrar antes de cada reunión que viene: las abiertas de su cliente
  // con vencimiento. Van todas y la card de cada reunión, al tocarla, se queda
  // con las de su cliente que vencen ese día o antes. Las abiertas sin
  // vencimiento no entran (no se sabe para qué reunión son): se cuentan.
  const clients = new Map<string, Client>();
  for (const m of [...upcoming, ...past]) {
    const c = clientOf(m);
    if (c) clients.set(c.id, c);
  }
  const members = new Map(team.map((m) => [m.id, m]));
  const openTasks = (taskData?.tasks ?? []).filter((t) => t.client_id && clients.has(t.client_id) && isOpenTask(t));
  const undated: Record<string, number> = {};
  for (const t of openTasks) if (!t.due_date) undated[t.client_id!] = (undated[t.client_id!] ?? 0) + 1;
  const prep: MeetingPrep | null = taskData && {
    tasks: openTasks
      .filter((t) => t.due_date)
      .sort((a, b) => a.due_date!.localeCompare(b.due_date!) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
      .map((t) => {
        const due = t.due_date!;
        const assignee = t.assignee_id ? members.get(t.assignee_id) : undefined;
        return {
          id: t.id,
          clientId: t.client_id!,
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
    undated,
    error: taskData.notionError,
    // Clientes sin proyecto de Notion vinculado: la card ofrece vincularlo.
    connectHrefs: Object.fromEntries(
      [...clients.values()].filter((c) => !c.conn.notion).map((c) => [c.id, `/clientes/${c.slug}/notion/conectar`]),
    ),
  };

  return { calendar, prep, today, months: windowMonths(today) };
}
