// Monitoreo de la atención por chat del CRM (hoy solo Kommo). Solo server.
//
// Sale de intranet_crm_chat_events: un registro por mensaje, sin el texto
// (lib/crm-chat-sync.ts). Con eso se mide cuánto se tarda en responder, qué
// conversaciones quedaron esperando y el volumen por responsable.
//
// Dos límites de fondo, que la vista aclara:
// - Quién respondió no se sabe: en Arteplac casi todas las respuestas salen de
//   la app de WhatsApp del teléfono y Kommo las registra sin usuario. Por eso
//   todo se agrupa por el RESPONSABLE del lead (en Arteplac, la sucursal), no
//   por quién escribió.
// - Sin el texto no se distingue una consulta de un "gracias": una conversación
//   que terminó con un mensaje del cliente figura como esperando respuesta.
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

// Mensajes del período (días de Argentina, extremos incluidos), del más viejo al
// más nuevo. Lee con la sesión del usuario (RLS). null = la tabla todavía no
// existe (falta correr docs/sql/2026-10-01-crm-chats.sql).
export async function getChatEvents(clientId: string, period: Period): Promise<ChatEvent[] | null> {
  const supabase = await createClient();
  const from = `${period.since}T00:00:00-03:00`;
  const to = `${period.until}T23:59:59.999-03:00`;
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

// ---------- Cálculo ----------

export type ChatGroup = {
  name: string;
  // Conversaciones con algún mensaje en el período.
  talks: number;
  incoming: number;
  outgoing: number;
  // Veces que un mensaje del cliente tuvo respuesta, y cuánto tardó (segundos).
  responses: number;
  medianResponse: number | null;
  // De esas, cuántas llegaron en 15 minutos o menos (0 a 1).
  fastShare: number | null;
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

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

type Acc = { talks: number; incoming: number; outgoing: number; delays: number[]; waiting: number };
const emptyAcc = (): Acc => ({ talks: 0, incoming: 0, outgoing: 0, delays: [], waiting: 0 });
const toGroup = (name: string, a: Acc): ChatGroup => ({
  name,
  talks: a.talks,
  incoming: a.incoming,
  outgoing: a.outgoing,
  responses: a.delays.length,
  medianResponse: median(a.delays),
  fastShare: a.delays.length ? a.delays.filter((d) => d <= FAST_S).length / a.delays.length : null,
  waiting: a.waiting,
});

// `events` en orden cronológico (como los devuelve getChatEvents).
//
// Una "respuesta" es el primer saliente después de uno o más entrantes seguidos:
// la demora se cuenta desde el primero de esos entrantes. El reloj es corrido,
// sin descontar noches ni fines de semana: un mensaje de las 23 h respondido a
// las 9 cuenta 10 horas. Por eso se muestra la mediana y no el promedio.
export function chatStats(events: ChatEvent[]): ChatStats {
  const byTalk = new Map<number, ChatEvent[]>();
  for (const e of events) {
    const list = byTalk.get(e.talk_id);
    if (list) list.push(e);
    else byTalk.set(e.talk_id, [e]);
  }

  const total = emptyAcc();
  const groups = new Map<string, Acc>();
  const waiting: WaitingChat[] = [];
  let fromKommo = 0;
  const now = Date.now();

  for (const [talkId, list] of byTalk) {
    // El responsable y el lead, como figuran en el mensaje más reciente que los traiga.
    const withLead = list.findLast((e) => e.owner || e.lead_name);
    const owner = list.findLast((e) => e.owner)?.owner ?? NO_OWNER;
    const acc = groups.get(owner) ?? emptyAcc();
    groups.set(owner, acc);

    let pending: string | null = null;
    for (const e of list) {
      if (e.incoming) {
        acc.incoming++;
        total.incoming++;
        pending ??= e.at;
      } else {
        acc.outgoing++;
        total.outgoing++;
        if (e.user_name) fromKommo++;
        if (pending) {
          const delay = (Date.parse(e.at) - Date.parse(pending)) / 1000;
          acc.delays.push(delay);
          total.delays.push(delay);
          pending = null;
        }
      }
    }
    acc.talks++;
    total.talks++;
    if (pending) {
      acc.waiting++;
      total.waiting++;
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
