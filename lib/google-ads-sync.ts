// Sincroniza las métricas de Google Ads a Supabase. Solo server: usa service_role.
//
// La solapa GADS lee siempre de intranet_gads_daily / intranet_gads_campaigns;
// acá se llenan. Corre por cron (app/api/cron/sync) y, como refuerzo, al abrir la
// vista si los datos quedaron viejos (prepareGadsView). Son dos consultas por
// cliente: el nivel Explorer tiene un tope diario de operaciones, y esto queda
// muy lejos.
//
// El estado (synced_at, sync_error) va en intranet_integration_secrets, provider
// "google_ads": no hay credenciales por cliente, pero así SyncStatus lo lee igual
// que en Meta, CRM y Clarity.
import { after } from "next/server";
import { todayISO } from "./format";
import { getAdsCampaignDays, getAdsDaily, googleAdsConfigured, googleAdsErrorMessage } from "./google-ads";
import { GADS_HISTORY_DAYS, shiftDate } from "./period";
import { createAdminClient } from "./supabase/server";

// En cada corrida se reescriben los últimos días: Google sigue atribuyendo
// conversiones a fechas pasadas.
const REFRESH_DAYS = 14;
// Antigüedad a partir de la cual una visita a la vista dispara un sync.
const STALE_MS = 6 * 60 * 60 * 1000;

export type GadsSecrets = { synced_at?: string | null; sync_error?: string | null };

export async function getGadsSecrets(clientId: string): Promise<GadsSecrets | null> {
  const { data } = await createAdminClient()
    .from("intranet_integration_secrets")
    .select("secrets")
    .eq("client_id", clientId)
    .eq("provider", "google_ads")
    .maybeSingle<{ secrets: GadsSecrets }>();
  return data?.secrets ?? null;
}

async function saveGadsSecrets(clientId: string, secrets: GadsSecrets) {
  const { error } = await createAdminClient()
    .from("intranet_integration_secrets")
    .upsert({ client_id: clientId, provider: "google_ads", secrets, updated_at: new Date().toISOString() });
  if (error) throw error;
}

// Al desvincular o cambiar de cuenta: los datos guardados son de la cuenta anterior.
export async function clearGadsData(clientId: string) {
  const db = createAdminClient();
  await Promise.all([
    db.from("intranet_gads_daily").delete().eq("client_id", clientId),
    db.from("intranet_gads_campaigns").delete().eq("client_id", clientId),
    db.from("intranet_integration_secrets").delete().eq("client_id", clientId).eq("provider", "google_ads"),
  ]);
}

export type GadsSyncResult = { clientId: string; ok: boolean; days: number; campaigns: number; error?: string };

// Trae las métricas de un cliente y reemplaza el rango sincronizado.
export async function syncGadsClient(clientId: string, customerId: string | null, full = false): Promise<GadsSyncResult> {
  const fail = (error: string) => ({ clientId, ok: false, days: 0, campaigns: 0, error });
  if (!customerId) return fail("El cliente no tiene una cuenta de Google Ads elegida.");

  const previous = await getGadsSecrets(clientId);
  const until = todayISO();
  const since = shiftDate(until, full || !previous?.synced_at ? GADS_HISTORY_DAYS : REFRESH_DAYS);

  try {
    const [daily, campaigns] = await Promise.all([
      getAdsDaily(customerId, since, until),
      getAdsCampaignDays(customerId, since, until),
    ]);
    const db = createAdminClient();
    const now = new Date().toISOString();

    if (daily.length) {
      const { error } = await db
        .from("intranet_gads_daily")
        .upsert(daily.map((d) => ({ client_id: clientId, ...d, synced_at: now })), { onConflict: "client_id,date" });
      if (error) throw error;
    }
    if (campaigns.length) {
      const { error } = await db
        .from("intranet_gads_campaigns")
        .upsert(campaigns.map((c) => ({ client_id: clientId, ...c })), { onConflict: "client_id,campaign_id,date" });
      if (error) throw error;
    }

    // Después de escribir, se borra lo del rango que Google ya no informa (un día
    // que quedó en cero, una campaña que dejó de tener impresiones ese día). Va al
    // final para no dejar la vista vacía si algo falla.
    const days = daily.map((d) => d.date);
    let dailyCleanup = db.from("intranet_gads_daily").delete().eq("client_id", clientId).gte("date", since).lte("date", until);
    if (days.length) dailyCleanup = dailyCleanup.not("date", "in", `(${days.join(",")})`);
    const seen = new Set(campaigns.map((c) => `${c.campaign_id}|${c.date}`));
    const { data: stored, error: readError } = await db
      .from("intranet_gads_campaigns")
      .select("campaign_id, date")
      .eq("client_id", clientId)
      .gte("date", since)
      .lte("date", until)
      .returns<{ campaign_id: string; date: string }[]>();
    if (readError) throw readError;
    const stale = (stored ?? []).filter((r) => !seen.has(`${r.campaign_id}|${r.date}`));

    const { error: cleanupError } = await dailyCleanup;
    if (cleanupError) throw cleanupError;
    for (const r of stale) {
      const { error } = await db
        .from("intranet_gads_campaigns")
        .delete()
        .eq("client_id", clientId)
        .eq("campaign_id", r.campaign_id)
        .eq("date", r.date);
      if (error) throw error;
    }

    await saveGadsSecrets(clientId, { synced_at: now, sync_error: null });
    return { clientId, ok: true, days: daily.length, campaigns: new Set(campaigns.map((c) => c.campaign_id)).size };
  } catch (e) {
    // Los errores de supabase-js son objetos planos, no instancias de Error.
    const message =
      e instanceof Error ? googleAdsErrorMessage(e) : ((e as { message?: string })?.message ?? "No se pudieron leer las métricas de Google Ads.");
    console.error("[google-ads] sync", clientId, message);
    await saveGadsSecrets(clientId, { ...previous, sync_error: message }).catch(() => {});
    return fail(message);
  }
}

type IntegrationRow = { client_id: string; account_ref: string | null };

// Todos los clientes con Google Ads conectado, de a uno.
export async function syncAllGadsClients(full = false): Promise<GadsSyncResult[]> {
  if (!googleAdsConfigured()) return [];
  const { data, error } = await createAdminClient()
    .from("intranet_client_integrations")
    .select("client_id, account_ref")
    .eq("provider", "google_ads")
    .eq("connected", true)
    .returns<IntegrationRow[]>();
  if (error) throw error;

  const results: GadsSyncResult[] = [];
  for (const row of data ?? []) results.push(await syncGadsClient(row.client_id, row.account_ref, full));
  return results;
}

// Refuerzo del cron al abrir la vista, como prepareMetaView:
// - Recién conectado (nunca se sincronizó): se espera el backfill para no
//   mostrar una pantalla vacía.
// - Datos viejos: el sync corre con after(), no bloquea el render y se ve en la
//   próxima carga.
export async function prepareGadsView(clientId: string, customerId: string | null): Promise<GadsSecrets | null> {
  const secrets = await getGadsSecrets(clientId);
  if (!secrets?.synced_at) {
    if (!secrets?.sync_error) {
      await syncGadsClient(clientId, customerId, true);
      return getGadsSecrets(clientId);
    }
    return secrets;
  }
  if (Date.now() - Date.parse(secrets.synced_at) > STALE_MS) after(() => syncGadsClient(clientId, customerId));
  return secrets;
}
