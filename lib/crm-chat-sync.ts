// Sincroniza la actividad de los chats de Kommo (intranet_crm_chat_events).
// Solo server. Lo llama syncCrmClient después de las oportunidades.
//
// Guarda un registro por mensaje, sin el texto: alcanza para medir tiempos de
// respuesta, conversaciones esperando y volumen por responsable (lib/crm-chats.ts).
import type { CrmLead } from "./crm-shared";
import { type KommoCredentials, kommoUsers, readKommoChatEvents, readKommoLeadOwners } from "./kommo";
import { createAdminClient, isMissingTable } from "./supabase/server";

// Hasta dónde se completa el historial hacia atrás, y cuánto se conserva.
const BACKFILL_DAYS = 30;
const KEEP_DAYS = 90;
// Páginas de Kommo por corrida (250 mensajes cada una, ~1 s por página). El cron
// tiene 60 s para todos los clientes: lo que no entra hoy se completa en las
// próximas corridas, siempre de lo más nuevo hacia atrás.
const MAX_PAGES = 16;
// Se vuelve a pedir un rato antes del último mensaje guardado, por si alguno
// llegó tarde a la API; el upsert por id no duplica.
const OVERLAP_S = 600;
const BATCH = 500;

export type ChatSyncResult = { ok: boolean; events: number; pending?: boolean; error?: string };

export async function syncKommoChats(clientId: string, creds: KommoCredentials, leads: CrmLead[]): Promise<ChatSyncResult> {
  const db = createAdminClient();
  const edge = async (ascending: boolean) => {
    const { data, error } = await db
      .from("intranet_crm_chat_events")
      .select("at")
      .eq("client_id", clientId)
      .order("at", { ascending })
      .limit(1)
      .returns<{ at: string }[]>();
    if (error) throw error;
    return data?.[0] ? Math.floor(Date.parse(data[0].at) / 1000) : null;
  };

  try {
    const [newest, oldest] = await Promise.all([edge(false), edge(true)]);
    const now = Math.floor(Date.now() / 1000);
    const target = now - BACKFILL_DAYS * 86_400;

    // 1) Lo nuevo desde la última corrida (o, la primera vez, lo más reciente).
    const fresh = await readKommoChatEvents(creds, {
      from: newest ? Math.max(newest - OVERLAP_S, target) : target,
      maxPages: MAX_PAGES,
    });
    const events = [...fresh.events];

    // 2) Con las páginas que sobraron, completar hacia atrás hasta BACKFILL_DAYS.
    // (Si lo nuevo ya se cortó, o es la primera corrida, sigue en la próxima.)
    const used = Math.max(1, Math.ceil(fresh.events.length / 250));
    if (!fresh.truncated && oldest && oldest > target && used < MAX_PAGES) {
      const older = await readKommoChatEvents(creds, { from: target, to: oldest, maxPages: MAX_PAGES - used });
      events.push(...older.events);
    }

    if (events.length) {
      const leadById = new Map(leads.map((l) => [l.externalId, { name: l.name, owner: l.owner }]));
      // Chats de leads que el sync de oportunidades no trae: se piden por id.
      const missing = [...new Set(events.map((e) => e.leadId).filter((id): id is string => !!id && !leadById.has(id)))];
      const [users, extra] = await Promise.all([kommoUsers(creds), readKommoLeadOwners(creds, missing)]);
      for (const [id, lead] of extra) leadById.set(id, lead);
      const rows = [...new Map(events.map((e) => [e.id, e])).values()].map((e) => {
        const lead = e.leadId ? leadById.get(e.leadId) : undefined;
        return {
          client_id: clientId,
          event_id: e.id,
          talk_id: e.talkId,
          lead_id: e.leadId,
          lead_name: lead?.name ?? null,
          owner: lead?.owner ?? null,
          incoming: e.incoming,
          user_name: e.userId ? (users.get(e.userId) ?? null) : null,
          origin: e.origin,
          at: e.at,
        };
      });
      for (let i = 0; i < rows.length; i += BATCH) {
        const { error } = await db
          .from("intranet_crm_chat_events")
          .upsert(rows.slice(i, i + BATCH), { onConflict: "client_id,event_id" });
        if (error) throw error;
      }
    }

    const { error: pruneError } = await db
      .from("intranet_crm_chat_events")
      .delete()
      .eq("client_id", clientId)
      .lt("at", new Date((now - KEEP_DAYS * 86_400) * 1000).toISOString());
    if (pruneError) throw pruneError;

    return { ok: true, events: events.length };
  } catch (e) {
    // Falta correr docs/sql/2026-10-01-crm-chats.sql: no es un error del sync.
    if (isMissingTable(e as { code?: string })) return { ok: true, events: 0, pending: true };
    const message = e instanceof Error ? e.message : ((e as { message?: string })?.message ?? "No se pudieron leer los chats.");
    console.error("[crm] chats", clientId, message);
    return { ok: false, events: 0, error: message };
  }
}
