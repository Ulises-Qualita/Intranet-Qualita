// Google Calendar: reuniones con clientes. Solo server.
//
// Lee los calendarios de todo el equipo con una cuenta de servicio con
// delegación de dominio (Workspace): nadie tiene que conectar nada, pero un
// super admin tiene que autorizar el client ID de la cuenta con CALENDAR_SCOPE en
// admin.google.com → Seguridad → Controles de API → Delegación de todo el dominio.
//
// Una reunión es de un cliente por la nomenclatura del estudio:
// "<Cliente> & Qualita <motivo>", p. ej. "Disegno Milano & Qualita - Revisión".
// Igual que los tickets de Notion, se lee en vivo y se cachea solo la consulta
// de todo el estudio; el filtro por cliente va fuera del cache, por request.
import { unstable_cache } from "next/cache";
import { isQualitaEmail } from "./auth-shared";
import { getTeam } from "./data";
import { GoogleAuthError, googleAccessToken, googleConfigured } from "./google";

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly";
const API = "https://www.googleapis.com/calendar/v3";

// Ventana que se muestra: el último trimestre y lo que viene.
const PAST_DAYS = 90;
const FUTURE_DAYS = 60;
const CACHE_TTL = 300;
export const MEETINGS_TAG = "calendar-meetings";

export const calendarConfigured = googleConfigured;

export class CalendarError extends Error {}

// Token de la cuenta de servicio actuando como cada miembro (lib/google.ts).
async function accessTokenFor(email: string) {
  try {
    return await googleAccessToken(email, CALENDAR_SCOPE);
  } catch (e) {
    if (e instanceof GoogleAuthError && e.code === "unauthorized_client") {
      throw new CalendarError("La cuenta de servicio no tiene la delegación de dominio autorizada para Calendar.");
    }
    throw new CalendarError(e instanceof Error ? e.message : "No se pudo autenticar con Google.");
  }
}

// ---------- Reuniones ----------

export type Meeting = {
  // Mismo evento en los calendarios de varios miembros → una sola reunión.
  key: string;
  // null en un evento que no sigue la nomenclatura (reunión interna, personal…):
  // solo aparece en la pantalla Reuniones del sidebar, con su título en `reason`.
  clientName: string | null;
  reason: string | null;
  start: string;
  end: string;
  allDay: boolean;
  meetUrl: string | null;
  attendees: { email: string; name: string | null }[];
  // Quien la creó: un evento sin invitados no trae attendees, solo esto.
  organizer: string | null;
};

type RawEvent = {
  iCalUID?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
  attendees?: { email?: string; displayName?: string; resource?: boolean; self?: boolean; responseStatus?: string }[];
  organizer?: { email?: string };
  eventType?: string;
};

const EVENT_FIELDS =
  "nextPageToken,items(iCalUID,summary,start,end,hangoutLink,conferenceData/entryPoints(entryPointType,uri),attendees(email,displayName,resource,self,responseStatus),organizer(email),eventType)";

// Nombre de un participante para mostrar: mayúscula al principio de cada palabra
// (sin tocar el resto: "mcDonald" queda) y, sin nombre en Calendar, el mail:
// "juan.perez@…" → "Juan Perez".
export function attendeeName(a: { email: string; name: string | null }) {
  const raw = a.name?.trim() || a.email.split("@")[0].replace(/[._-]+/g, " ");
  return raw
    .split(/\s+/)
    .map((w) => w.charAt(0).toLocaleUpperCase("es-AR") + w.slice(1))
    .join(" ");
}

// Para comparar nombres sin que molesten mayúsculas, tildes ni espacios de más.
export const normalizeName = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

// "Disegno Milano & Qualita - Revisión" → { clientName: "Disegno Milano", reason: "Revisión" }.
// Todo lo que no respete la nomenclatura queda afuera.
export function parseMeetingTitle(title: string) {
  const amp = title.indexOf("&");
  if (amp <= 0) return null;
  const clientName = title.slice(0, amp).trim();
  const rest = title.slice(amp + 1).trim();
  const studio = rest.match(/^qualita(\s+studio)?\b/i);
  if (!clientName || !studio) return null;
  const reason = rest.slice(studio[0].length).replace(/^[\s\-–—:|·.,/]+/, "").trim();
  return { clientName, reason: reason || null };
}

// Instante de un `start` / `end`. Calendar los manda con el huso del calendario
// ("…T11:00:00-03:00"), así que compararlos como texto contra un ISO en UTC corre
// todo tres horas: una reunión de las 11 figuraba como pasada desde las 8. Los
// eventos de todo el día traen solo la fecha, que se toma en horario de Argentina.
export const meetingTime = (value: string) => Date.parse(value.length === 10 ? `${value}T00:00:00-03:00` : value);

// `any`: también los eventos que no son de un cliente (el calendario propio de
// un miembro); si no, solo los que siguen la nomenclatura.
function toMeeting(e: RawEvent, any = false): Meeting | null {
  const parsed = (e.summary ? parseMeetingTitle(e.summary) : null) ?? (any ? { clientName: null, reason: e.summary?.trim() || "Sin título" } : null);
  const start = e.start?.dateTime ?? e.start?.date;
  const end = e.end?.dateTime ?? e.end?.date ?? start;
  if (!parsed || !start || !end) return null;

  const video = e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri;
  const meetUrl = [e.hangoutLink, video].find((u) => u?.startsWith("https://")) ?? null;

  return {
    key: `${e.iCalUID ?? e.summary}|${start}`,
    ...parsed,
    start,
    end,
    allDay: !e.start?.dateTime,
    meetUrl,
    attendees: (e.attendees ?? [])
      .filter((a) => a.email && !a.resource)
      .map((a) => ({ email: a.email!, name: a.displayName ?? null })),
    organizer: e.organizer?.email ?? null,
  };
}

async function memberMeetings(email: string, timeMin: string, timeMax: string, all = false) {
  const token = await accessTokenFor(email);
  const meetings: Meeting[] = [];
  let pageToken: string | undefined;
  // Tope de páginas por las dudas (2500 eventos cada una).
  for (let i = 0; i < 10; i++) {
    const url = new URL(`${API}/calendars/primary/events`);
    url.search = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "2500",
      // Achica la respuesta; el filtro real por nomenclatura es parseMeetingTitle.
      ...(all ? {} : { q: "Qualita" }),
      fields: EVENT_FIELDS,
      ...(pageToken ? { pageToken } : {}),
    }).toString();
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) throw new CalendarError(body?.error?.message ?? `Google Calendar respondió ${res.status}`);
    for (const e of (body.items ?? []) as RawEvent[]) {
      if (all) {
        // Del calendario propio no van la ubicación de trabajo ni los cumpleaños
        // (no son reuniones), ni lo que el miembro rechazó.
        if (e.eventType === "workingLocation" || e.eventType === "birthday") continue;
        if (e.attendees?.some((a) => a.self && a.responseStatus === "declined")) continue;
      }
      const m = toMeeting(e, all);
      if (m) meetings.push(m);
    }
    pageToken = body.nextPageToken;
    if (!pageToken) break;
  }
  return meetings;
}

// Todas las reuniones con clientes del estudio, de los calendarios de todo el
// equipo. Lo único que se cachea: depende solo de la lista de mails, nunca de la
// sesión. Si falla un calendario (p. ej. una cuenta suspendida) se sigue con el
// resto; si fallan todos, tira y no se cachea el error.
const getStudioMeetings = unstable_cache(
  async (emails: string[]): Promise<Meeting[]> => {
    const now = Date.now();
    const timeMin = new Date(now - PAST_DAYS * 86_400_000).toISOString();
    const timeMax = new Date(now + FUTURE_DAYS * 86_400_000).toISOString();

    const byKey = new Map<string, Meeting>();
    const errors: unknown[] = [];
    // De a 5 calendarios en paralelo para no pegarle a la cuota todos juntos.
    for (let i = 0; i < emails.length; i += 5) {
      const batch = await Promise.allSettled(emails.slice(i, i + 5).map((e) => memberMeetings(e, timeMin, timeMax)));
      batch.forEach((r, j) => {
        if (r.status === "fulfilled") r.value.forEach((m) => byKey.set(m.key, byKey.get(m.key) ?? m));
        else {
          errors.push(r.reason);
          console.error("[calendar]", emails[i + j], r.reason instanceof Error ? r.reason.message : r.reason);
        }
      });
    }
    if (emails.length && errors.length === emails.length) throw errors[0];
    return [...byKey.values()].sort((a, b) => meetingTime(a.start) - meetingTime(b.start));
  },
  ["calendar-meetings"],
  { revalidate: CACHE_TTL, tags: [MEETINGS_TAG] },
);

export type ClientMeetings = { upcoming: Meeting[]; past: Meeting[]; error: string | null };

// Las reuniones del estudio que cumplen `keep`, separadas en próximas y pasadas.
// getTeam usa service_role: quien la llama ya validó el acceso.
async function meetingsWhere(keep: (m: Meeting) => boolean): Promise<ClientMeetings> {
  if (!calendarConfigured()) return { upcoming: [], past: [], error: "config" };
  try {
    const emails = (await getTeam())
      .filter((m) => m.active && isQualitaEmail(m.email))
      .map((m) => m.email!.toLowerCase())
      .sort();
    const mine = (await getStudioMeetings(emails)).filter(keep);
    const now = Date.now();
    // En curso cuenta como próxima: es la que tiene el link para entrar.
    return {
      upcoming: mine.filter((m) => meetingTime(m.end) >= now),
      past: mine.filter((m) => meetingTime(m.end) < now).reverse(),
      error: null,
    };
  } catch (e) {
    return {
      upcoming: [],
      past: [],
      error: e instanceof Error ? e.message : "No se pudo leer Google Calendar.",
    };
  }
}

// Reuniones de un cliente. Quien la llama ya validó el acceso a ese cliente.
export async function getClientMeetings(clientName: string): Promise<ClientMeetings> {
  const target = normalizeName(clientName);
  return meetingsWhere((m) => m.clientName !== null && normalizeName(m.clientName) === target);
}

// Todo el calendario propio de un miembro (reuniones con clientes, internas y el
// resto de sus eventos), para la pantalla Reuniones del sidebar. Se lee como él
// y solo lo ve él. Cacheado por mail, igual que la consulta del estudio.
const getOwnCalendar = unstable_cache(
  async (email: string): Promise<Meeting[]> => {
    const now = Date.now();
    const timeMin = new Date(now - PAST_DAYS * 86_400_000).toISOString();
    const timeMax = new Date(now + FUTURE_DAYS * 86_400_000).toISOString();
    return (await memberMeetings(email, timeMin, timeMax, true)).sort((a, b) => meetingTime(a.start) - meetingTime(b.start));
  },
  ["calendar-own"],
  { revalidate: CACHE_TTL, tags: [MEETINGS_TAG] },
);

export async function getMemberMeetings(email: string): Promise<ClientMeetings> {
  if (!calendarConfigured()) return { upcoming: [], past: [], error: "config" };
  try {
    const mine = await getOwnCalendar(email.toLowerCase());
    const now = Date.now();
    return {
      upcoming: mine.filter((m) => meetingTime(m.end) >= now),
      past: mine.filter((m) => meetingTime(m.end) < now).reverse(),
      error: null,
    };
  } catch (e) {
    return { upcoming: [], past: [], error: e instanceof Error ? e.message : "No se pudo leer Google Calendar." };
  }
}
