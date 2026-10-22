// Sincroniza el historial de etapas de Kommo (intranet_crm_stage_events).
// Solo server. Lo llama syncCrmClient después de los chats.
//
// intranet_leads guarda solo la etapa actual; con esto se sabe en qué etapa
// estaba cada lead cuando llegó cada mensaje (crm_atencion del agente).
import { type KommoCredentials, readKommoStageEvents } from "./kommo";
import { createAdminClient, isMissingTable } from "./supabase/server";

// Hasta dónde se completa hacia atrás (los leads que trae el sync, LEAD_DAYS) y
// cuánto se conserva: más que los chats (90 días), porque la etapa de un lead
// en un mensaje depende de cambios anteriores.
const BACKFILL_DAYS = 95;
const KEEP_DAYS = 180;
// Páginas de Kommo por corrida (250 cambios cada una). Arteplac tiene unos 550
// por mes: el primer sync completa los 95 días en 7 páginas; después es una.
const MAX_PAGES = 8;
const OVERLAP_S = 600;
const BATCH = 500;

export type StageSyncResult = { ok: boolean; events: number; pending?: boolean; error?: string };

export async function syncKommoStages(clientId: string, creds: KommoCredentials): Promise<StageSyncResult> {
  const db = createAdminClient();
  const edge = async (ascending: boolean) => {
    const { data, error } = await db
      .from("intranet_crm_stage_events")
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

    // Igual que los chats: primero lo nuevo, y con las páginas que sobran se
    // completa hacia atrás.
    const fresh = await readKommoStageEvents(creds, {
      from: newest ? Math.max(newest - OVERLAP_S, target) : target,
      maxPages: MAX_PAGES,
    });
    const events = [...fresh.events];
    const used = Math.max(1, Math.ceil(fresh.events.length / 250));
    if (!fresh.truncated && oldest && oldest > target && used < MAX_PAGES) {
      const older = await readKommoStageEvents(creds, { from: target, to: oldest, maxPages: MAX_PAGES - used });
      events.push(...older.events);
    }

    const rows = events.map((e) => ({
      client_id: clientId,
      event_id: e.id,
      lead_id: e.leadId,
      from_stage: e.from,
      to_stage: e.to,
      at: e.at,
    }));
    for (let i = 0; i < rows.length; i += BATCH) {
      const { error } = await db.from("intranet_crm_stage_events").upsert(rows.slice(i, i + BATCH), { onConflict: "client_id,event_id" });
      if (error) throw error;
    }

    const { error: pruneError } = await db
      .from("intranet_crm_stage_events")
      .delete()
      .eq("client_id", clientId)
      .lt("at", new Date((now - KEEP_DAYS * 86_400) * 1000).toISOString());
    if (pruneError) throw pruneError;

    return { ok: true, events: events.length };
  } catch (e) {
    // Falta correr docs/sql/2026-10-22-crm-etapas.sql: no es un error del sync.
    if (isMissingTable(e as { code?: string })) return { ok: true, events: 0, pending: true };
    const message = e instanceof Error ? e.message : ((e as { message?: string })?.message ?? "No se pudo leer el historial de etapas.");
    console.error("[crm] etapas", clientId, message);
    return { ok: false, events: 0, error: message };
  }
}
