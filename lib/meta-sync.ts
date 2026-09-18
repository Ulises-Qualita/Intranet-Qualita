// Sincroniza las métricas de Meta a Supabase. Solo server: usa service_role y el
// token guardado de cada cliente.
//
// La vista de META lee siempre de intranet_meta_daily / intranet_meta_ads; acá se
// llenan esas tablas. Corre por cron (app/api/cron/meta) y, como refuerzo, al
// abrir la vista si los datos quedaron viejos (syncMetaIfStale).
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import {
  getAccountInsights,
  getAdInsights,
  getAdStatuses,
  getMetaSecrets,
  isAuthError,
  saveMetaSecrets,
} from "./meta";
import { createAdminClient } from "./supabase/server";

// Ventana del backfill inicial: cubre el período más largo que ofrece la vista.
export const SYNC_DAYS = 90;
// En cada corrida se reescriben solo los últimos días: Meta sigue atribuyendo
// conversiones a fechas pasadas durante ~7 días.
const REFRESH_DAYS = 7;
// Antigüedad a partir de la cual una visita a la vista dispara un sync.
const STALE_MS = 6 * 60 * 60 * 1000;

const day = (offset = 0) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

export type MetaSyncResult = { clientId: string; ok: boolean; days: number; ads: number; error?: string };

// Trae los insights de un cliente y reemplaza el rango sincronizado.
export async function syncMetaClient(clientId: string, accountRef: string | null, full = false): Promise<MetaSyncResult> {
  const fail = (error: string) => ({ clientId, ok: false, days: 0, ads: 0, error });

  const secrets = await getMetaSecrets(clientId);
  if (!secrets) return fail("La sesión de Facebook venció o no existe. Hay que volver a conectar Meta.");
  if (!accountRef) return fail("El cliente no tiene una cuenta publicitaria elegida.");

  const since = day(full || !secrets.synced_at ? SYNC_DAYS : REFRESH_DAYS);
  const until = day(0);

  try {
    const [daily, ads, statuses] = await Promise.all([
      getAccountInsights(secrets.access_token, accountRef, since, until),
      getAdInsights(secrets.access_token, accountRef, since, until),
      getAdStatuses(secrets.access_token, accountRef).catch(() => new Map<string, string>()),
    ]);

    const db = createAdminClient();

    if (daily.length) {
      const { error } = await db
        .from("intranet_meta_daily")
        .upsert(daily.map((d) => ({ client_id: clientId, ...d })), { onConflict: "client_id,date" });
      if (error) throw error;
    }

    // Los anuncios se guardan por día (as_of): la vista suma el período elegido.
    if (ads.length) {
      const { error } = await db.from("intranet_meta_ads").upsert(
        ads.map((a) => ({
          id: randomUUID(),
          client_id: clientId,
          ad_external_id: a.adId,
          name: a.name,
          campaign_external_id: a.campaignId,
          campaign_name: a.campaignName,
          status: statuses.get(a.adId) ?? "pausado",
          spend: a.spend,
          leads: a.leads,
          clicks: a.clicks,
          impressions: a.impressions,
          revenue: a.revenue,
          as_of: a.date,
        })),
        { onConflict: "client_id,ad_external_id,as_of" },
      );
      if (error) throw error;
    }

    // Después de escribir, se limpian las filas del rango que Meta ya no reporta
    // (anuncios borrados). Va al final para no dejar la vista vacía si algo falla.
    const seen = [...new Set(ads.map((a) => a.adId))];
    let cleanup = db.from("intranet_meta_ads").delete().eq("client_id", clientId).gte("as_of", since).lte("as_of", until);
    if (seen.length) cleanup = cleanup.or(`ad_external_id.is.null,ad_external_id.not.in.(${seen.join(",")})`);
    const { error: cleanupError } = await cleanup;
    if (cleanupError) throw cleanupError;

    await saveMetaSecrets(clientId, { ...secrets, synced_at: new Date().toISOString(), sync_error: null });
    return { clientId, ok: true, days: daily.length, ads: ads.length };
  } catch (e) {
    // Los errores de supabase-js son objetos planos, no instancias de Error.
    const detail = e instanceof Error ? e.message : ((e as { message?: string })?.message ?? "");
    console.error("[meta] sync", clientId, detail || e);
    const message = isAuthError(e)
      ? "La sesión de Facebook venció o fue revocada. Hay que volver a conectar Meta."
      : detail || "No se pudieron leer las métricas de Meta.";
    await saveMetaSecrets(clientId, { ...secrets, sync_error: message }).catch(() => {});
    return fail(message);
  }
}

type IntegrationRow = { client_id: string; account_ref: string | null };

// Todos los clientes con Meta conectado. De a uno para no saturar la Graph API.
export async function syncAllMetaClients(full = false): Promise<MetaSyncResult[]> {
  const { data, error } = await createAdminClient()
    .from("intranet_client_integrations")
    .select("client_id, account_ref")
    .eq("provider", "meta")
    .eq("connected", true)
    .returns<IntegrationRow[]>();
  if (error) throw error;

  const results: MetaSyncResult[] = [];
  for (const row of data ?? []) results.push(await syncMetaClient(row.client_id, row.account_ref, full));
  return results;
}

// Refuerzo del cron al abrir la vista de META.
// - Si el cliente nunca se sincronizó (recién conectado), se espera el backfill
//   para no mostrar una pantalla vacía.
// - Si los datos quedaron viejos, el sync corre con after(): no bloquea el render
//   y se ve en la próxima carga.
// Devuelve los secrets ya actualizados, o null si no hay sesión de Facebook.
export async function prepareMetaView(clientId: string, accountRef: string | null) {
  const secrets = await getMetaSecrets(clientId);
  if (!secrets) return null;

  if (!secrets.synced_at) {
    await syncMetaClient(clientId, accountRef, true);
    return getMetaSecrets(clientId);
  }
  if (Date.now() - Date.parse(secrets.synced_at) > STALE_MS) {
    after(() => syncMetaClient(clientId, accountRef));
  }
  return secrets;
}
