// Monitoreo de la atención por chat del CRM (hoy solo Kommo). Solo server.
//
// Sale de intranet_crm_chat_events: un registro por mensaje, sin el texto
// (lib/crm-chat-sync.ts). Con eso se mide cuánto tarda la primera respuesta a
// cada lead nuevo, qué conversaciones quedaron esperando y el volumen por
// responsable.
//
// Límites de fondo, que la vista aclara:
// - Quién respondió no se sabe: en Arteplac casi todas las respuestas salen de
//   la app de WhatsApp del teléfono y Kommo las registra sin usuario (no son
//   bots: ver docs/contexto-kommo.md). Por eso todo se agrupa por el RESPONSABLE
//   del lead (en Arteplac, la sucursal), no por quién escribió.
// - Sin el texto no se distingue una consulta de un "gracias": una conversación
//   que terminó con un mensaje del cliente figura como esperando respuesta.
import type { Lead } from "./data";
import { localDate } from "./format";
import type { Period } from "./period";
import { createClient, isMissingTable } from "./supabase/server";

export type ChatEvent = {
  talk_id: number;
  lead_id: string | null;
  lead_name: string | null;
  owner: string | null;
  incoming: boolean;
  user_name: string | null;
  origin: string | null;
  at: string;
};

const COLUMNS = "talk_id, lead_id, lead_name, owner, incoming, user_name, origin, at";
const PAGE_SIZE = 1000;
// Pedidos en paralelo por tanda: un mes de Arteplac son unas 20 páginas.
const PARALLEL = 8;
// Días que se leen después del período: la respuesta a un lead del último día
// puede llegar más tarde, y sin ese tramo figuraría como sin responder.
const TAIL_DAYS = 7;

const dayStart = (isoDate: string) => `${isoDate}T00:00:00-03:00`;
const dayEnd = (isoDate: string) => `${isoDate}T23:59:59.999-03:00`;

// Mensajes desde el inicio del período (días de Argentina) hasta TAIL_DAYS después
// de su fin, del más viejo al más nuevo. Lee con la sesión del usuario (RLS).
// null = la tabla todavía no existe (falta correr docs/sql/2026-10-01-crm-chats.sql).
export async function getChatEvents(clientId: string, period: Period): Promise<ChatEvent[] | null> {
  const supabase = await createClient();
  const from = dayStart(period.since);
  const to = new Date(Date.parse(dayEnd(period.until)) + TAIL_DAYS * 86_400_000).toISOString();
  const query = () =>
    supabase.from("intranet_crm_chat_events").select(COLUMNS, { count: "exact" }).eq("client_id", clientId).gte("at", from).lte("at", to);

  // PostgREST corta en 1000 filas: la primera página trae además el total.
  const first = await query().order("at").order("event_id").range(0, PAGE_SIZE - 1).returns<ChatEvent[]>();
  if (first.error) {
    if (isMissingTable(first.error)) return null;
    throw first.error;
  }
  const rows = [...(first.data ?? [])];
  const total = first.count ?? rows.length;

  const starts: number[] = [];
  for (let start = PAGE_SIZE; start < total; start += PAGE_SIZE) starts.push(start);
  for (let i = 0; i < starts.length; i += PARALLEL) {
    const pages = await Promise.all(
      starts.slice(i, i + PARALLEL).map((start) =>
        query()
          .order("at")
          .order("event_id")
          .range(start, start + PAGE_SIZE - 1)
          .returns<ChatEvent[]>(),
      ),
    );
    for (const page of pages) {
      if (page.error) throw page.error;
      rows.push(...(page.data ?? []));
    }
  }
  return rows;
}

// Desde cuándo hay mensajes guardados del cliente. El historial se completa de a
// poco y hacia atrás: de un lead anterior a esta fecha no se tiene su primer mensaje.
export async function getChatStart(clientId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("intranet_crm_chat_events")
    .select("at")
    .eq("client_id", clientId)
    .order("at")
    .limit(1)
    .returns<{ at: string }[]>();
  if (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  return data?.[0]?.at ?? null;
}

// ---------- Cálculo ----------

export type ChatGroup = {
  name: string;
  // Volumen del período: conversaciones con algún mensaje, recibidos y enviados.
  talks: number;
  incoming: number;
  outgoing: number;
  // Leads nuevos del período que escribieron, y cuántos tuvieron respuesta.
  leads: number;
  responses: number;
  // Demora de la primera respuesta (segundos): mediana general y según si el
  // lead escribió dentro o fuera del horario de atención.
  medianResponse: number | null;
  medianInHours: number | null;
  medianOffHours: number | null;
  // De los que escribieron, cuántos tuvieron respuesta en 15 minutos o menos (0 a 1).
  fastShare: number | null;
  // Leads nuevos que escribieron y nadie les respondió.
  unanswered: number;
  // Conversaciones cuyo último mensaje es del cliente.
  waiting: number;
};

export type WaitingChat = {
  talkId: number;
  leadId: string | null;
  leadName: string | null;
  owner: string;
  origin: string | null;
  // Desde cuándo espera (el primer mensaje del cliente que quedó sin respuesta)
  // y cuántos segundos lleva, al momento de armar la vista.
  since: string;
  waited: number;
};

export type ChatStats = {
  total: ChatGroup;
  // Por responsable del lead, de más a menos conversaciones.
  groups: ChatGroup[];
  // Las que más recientemente quedaron esperando, primero.
  waiting: WaitingChat[];
  // Salientes enviados por un usuario de Kommo, sobre el total de salientes: dice
  // cuánto de la atención pasa por Kommo y cuánto por fuera.
  fromKommo: number;
};

export const NO_OWNER = "Sin responsable";
const FAST_S = 15 * 60;

// Horario de atención para separar las demoras: lunes a viernes de 9 a 18 h de
// Argentina. Es el que se asumió para Arteplac (docs/contexto-kommo.md, pendiente
// de confirmar con el cliente); si otro cliente atiende distinto, pasa a ser
// configuración.
export const WORK_HOURS = { from: 9, to: 18, label: "lunes a viernes de 9 a 18 h" };
const WORK_DAYS = new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]);
const clock = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Argentina/Buenos_Aires",
  weekday: "short",
  hour: "numeric",
  hourCycle: "h23",
});

function inWorkHours(iso: string) {
  const parts = clock.formatToParts(new Date(iso));
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  return WORK_DAYS.has(weekday) && hour >= WORK_HOURS.from && hour < WORK_HOURS.to;
}

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

type Acc = { talks: number; incoming: number; outgoing: number; leads: number; inHours: number[]; offHours: number[]; waiting: number };
const emptyAcc = (): Acc => ({ talks: 0, incoming: 0, outgoing: 0, leads: 0, inHours: [], offHours: [], waiting: 0 });
const toGroup = (name: string, a: Acc): ChatGroup => {
  const delays = [...a.inHours, ...a.offHours];
  return {
    name,
    talks: a.talks,
    incoming: a.incoming,
    outgoing: a.outgoing,
    leads: a.leads,
    responses: delays.length,
    medianResponse: median(delays),
    medianInHours: median(a.inHours),
    medianOffHours: median(a.offHours),
    fastShare: a.leads ? delays.filter((d) => d <= FAST_S).length / a.leads : null,
    unanswered: a.leads - delays.length,
    waiting: a.waiting,
  };
};

// `events` en orden cronológico (como los devuelve getChatEvents, con su tramo
// posterior al período). `leads`: las oportunidades que cuentan (getLeads).
// `storedSince`: desde cuándo hay mensajes guardados (getChatStart).
//
// El tiempo de respuesta es el de la PRIMERA respuesta a cada lead nuevo del
// período: del primer mensaje que mandó el cliente al primer saliente posterior,
// lo haya enviado quien lo haya enviado. Medir cada ida y vuelta de todas las
// conversaciones (como se hacía antes) da minutos, porque pesa el ping-pong de
// las charlas ya empezadas y de los clientes viejos, y tapa lo que importa:
// cuánto espera una consulta nueva. El reloj es corrido; por eso la demora se
// separa según el lead haya escrito dentro o fuera del horario de atención.
export function chatStats(
  events: ChatEvent[],
  { leads, period, storedSince }: { leads: Lead[]; period: Period; storedSince: string | null },
): ChatStats {
  const periodEnd = Date.parse(dayEnd(period.until));

  const total = emptyAcc();
  const groups = new Map<string, Acc>();
  const groupOf = (owner: string) => {
    let acc = groups.get(owner);
    if (!acc) groups.set(owner, (acc = emptyAcc()));
    return acc;
  };

  const byTalk = new Map<number, ChatEvent[]>();
  const byLead = new Map<string, ChatEvent[]>();
  for (const e of events) {
    const talk = byTalk.get(e.talk_id);
    if (talk) talk.push(e);
    else byTalk.set(e.talk_id, [e]);
    if (!e.lead_id) continue;
    const lead = byLead.get(e.lead_id);
    if (lead) lead.push(e);
    else byLead.set(e.lead_id, [e]);
  }

  // ---- Volumen y conversaciones esperando, por conversación ----
  const waiting: WaitingChat[] = [];
  let fromKommo = 0;
  const now = Date.now();

  for (const [talkId, list] of byTalk) {
    // El responsable y el lead, como figuran en el mensaje más reciente que los traiga.
    const withLead = list.findLast((e) => e.owner || e.lead_name);
    const owner = list.findLast((e) => e.owner)?.owner ?? NO_OWNER;

    // El volumen cuenta solo lo del período; para saber si quedó esperando se
    // mira también lo que vino después.
    let incoming = 0;
    let outgoing = 0;
    let pending: string | null = null;
    for (const e of list) {
      const counts = Date.parse(e.at) <= periodEnd;
      if (e.incoming) {
        if (counts) incoming++;
        pending ??= e.at;
      } else {
        if (counts) {
          outgoing++;
          if (e.user_name) fromKommo++;
        }
        pending = null;
      }
    }
    if (!incoming && !outgoing) continue;

    for (const acc of [groupOf(owner), total]) {
      acc.talks++;
      acc.incoming += incoming;
      acc.outgoing += outgoing;
      if (pending) acc.waiting++;
    }
    if (pending) {
      waiting.push({
        talkId,
        leadId: withLead?.lead_id ?? list.at(-1)!.lead_id,
        leadName: withLead?.lead_name ?? null,
        owner,
        origin: list.at(-1)!.origin,
        since: pending,
        waited: Math.max(0, (now - Date.parse(pending)) / 1000),
      });
    }
  }

  // ---- Primera respuesta, por lead nuevo del período ----
  // Un lead creado antes de que haya mensajes guardados no tiene acá su primer
  // mensaje: lo primero que se ve de él es una charla ya empezada.
  const stored = storedSince ? Date.parse(storedSince) : null;
  for (const lead of leads) {
    const day = localDate(lead.created_at);
    if (!lead.external_id || day < period.since || day > period.until) continue;
    if (stored === null || Date.parse(lead.created_at) < stored) continue;

    const list = byLead.get(lead.external_id) ?? [];
    const first = list.findIndex((e) => e.incoming);
    if (first === -1) continue;

    const reply = list.slice(first + 1).find((e) => !e.incoming);
    const key = inWorkHours(list[first].at) ? "inHours" : "offHours";
    for (const acc of [groupOf(lead.owner ?? NO_OWNER), total]) {
      acc.leads++;
      if (reply) acc[key].push((Date.parse(reply.at) - Date.parse(list[first].at)) / 1000);
    }
  }

  return {
    total: toGroup("Total", total),
    groups: [...groups].map(([name, a]) => toGroup(name, a)).sort((a, b) => b.talks - a.talks),
    waiting: waiting.sort((a, b) => b.since.localeCompare(a.since)),
    fromKommo,
  };
}

// "45 s", "12 min", "3 h 20 min", "2 d 4 h".
export function duration(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days} d ${hours % 24} h` : `${days} d`;
}
