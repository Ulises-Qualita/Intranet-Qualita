// Sincroniza Clarity a Supabase. Solo server: usa service_role y el token de cada
// cliente.
//
// Una foto por día y nada más. Clarity permite 10 llamadas por proyecto por día y
// cada foto usa 3, así que correrlo más seguido no aporta: las ventanas de 24 h se
// solaparían y habría que decidir cuál pisa a cuál para no contar sesiones dos
// veces. La vista lee siempre de las tablas, nunca de la API.
import { randomUUID } from "node:crypto";
import { clarityErrorMessage, getClarityDay, getClaritySecrets, saveClaritySecrets } from "./clarity";
import { todayISO } from "./format";
import { createAdminClient } from "./supabase/server";

export type ClaritySyncResult = { clientId: string; ok: boolean; sessions: number; error?: string };

export async function syncClarityClient(clientId: string): Promise<ClaritySyncResult> {
  const secrets = await getClaritySecrets(clientId);
  if (!secrets) return { clientId, ok: false, sessions: 0, error: "El cliente no tiene Clarity conectado." };

  try {
    const { day, pages } = await getClarityDay(secrets.token);
    const db = createAdminClient();
    const as_of = todayISO();

    const { error } = await db
      .from("intranet_clarity_daily")
      .upsert({ client_id: clientId, as_of, ...day, synced_at: new Date().toISOString() }, { onConflict: "client_id,as_of" });
    if (error) throw error;

    if (pages.length) {
      const { error: pagesError } = await db.from("intranet_clarity_pages").upsert(
        pages.map((p) => ({ id: randomUUID(), client_id: clientId, as_of, ...p })),
        { onConflict: "client_id,as_of,url" },
      );
      if (pagesError) throw pagesError;
    }

    await saveClaritySecrets(clientId, { ...secrets, synced_at: new Date().toISOString(), sync_error: null });
    return { clientId, ok: true, sessions: day.sessions };
  } catch (e) {
    // Los errores de supabase-js son objetos planos, no instancias de Error.
    const message = clarityErrorMessage(e);
    console.error("[clarity] sync", clientId, e);
    await saveClaritySecrets(clientId, { ...secrets, sync_error: message }).catch(() => {});
    return { clientId, ok: false, sessions: 0, error: message };
  }
}

// Todos los clientes con Clarity conectado, de a uno para no disparar en paralelo
// contra el mismo límite de la API.
export async function syncAllClarityClients(): Promise<ClaritySyncResult[]> {
  const { data, error } = await createAdminClient()
    .from("intranet_client_integrations")
    .select("client_id")
    .eq("provider", "clarity")
    .eq("connected", true)
    .returns<{ client_id: string }[]>();
  if (error) throw error;

  const results: ClaritySyncResult[] = [];
  for (const row of data ?? []) results.push(await syncClarityClient(row.client_id));
  return results;
}
