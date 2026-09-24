// Sincroniza el CRM de cada cliente a Supabase (intranet_leads +
// intranet_crm_snapshot). Solo server: usa service_role y las credenciales
// guardadas del CRM.
//
// Cada cliente puede usar un CRM distinto; el proveedor sale de los secrets.
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { crmStatusOf, type CrmLead, type CrmProvider } from "./crm-shared";
import { todayISO } from "./format";
import { readKommo, type KommoCredentials } from "./kommo";
import { getOdooOpportunities, getOdooStages, odooConnect, type OdooCredentials } from "./odoo";
import { createAdminClient } from "./supabase/server";

// Antigüedad a partir de la cual abrir la vista dispara un sync.
const STALE_MS = 6 * 60 * 60 * 1000;

// Tope de filas por respuesta de PostgREST.
const PAGE_SIZE = 1000;
const DELETE_BATCH = 200;

export type CrmSecrets = {
  provider: CrmProvider;
  odoo?: OdooCredentials;
  kommo?: KommoCredentials;
  // Etapas en el orden del CRM: ordena el embudo de la vista.
  stage_order?: string[];
  // Etapas que cuentan como venta ganada, elegidas por cliente. El pipeline suele
  // seguir después del cierre (producción, entrega), y ahí el CRM ya no marca la
  // oportunidad como ganada.
  won_stages?: string[];
  synced_at?: string;
  sync_error?: string | null;
};

export async function getCrmSecrets(clientId: string): Promise<CrmSecrets | null> {
  const { data } = await createAdminClient()
    .from("intranet_integration_secrets")
    .select("secrets")
    .eq("client_id", clientId)
    .eq("provider", "crm")
    .maybeSingle<{ secrets: CrmSecrets }>();
  return data?.secrets?.provider ? data.secrets : null;
}

export async function saveCrmSecrets(clientId: string, secrets: CrmSecrets) {
  const { error } = await createAdminClient()
    .from("intranet_integration_secrets")
    .upsert({ client_id: clientId, provider: "crm", secrets, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function deleteCrmSecrets(clientId: string) {
  await createAdminClient().from("intranet_integration_secrets").delete().eq("client_id", clientId).eq("provider", "crm");
}

// Lee el CRM que corresponda. Devuelve los leads ya traducidos y el orden de las
// etapas para el embudo.
async function readCrm(secrets: CrmSecrets): Promise<{ leads: CrmLead[]; stages: string[] }> {
  if (secrets.provider === "odoo") {
    if (!secrets.odoo) throw new Error("Faltan las credenciales de Odoo.");
    const session = await odooConnect(secrets.odoo);
    const [leads, stages] = await Promise.all([
      getOdooOpportunities(session),
      getOdooStages(session).catch(() => []),
    ]);
    return { leads, stages };
  }
  if (secrets.provider === "kommo") {
    if (!secrets.kommo) throw new Error("Falta el token de Kommo.");
    return readKommo(secrets.kommo);
  }
  throw new Error(`El CRM "${secrets.provider}" todavía no está integrado.`);
}

export type CrmSyncResult = { clientId: string; ok: boolean; leads: number; error?: string };

export async function syncCrmClient(clientId: string): Promise<CrmSyncResult> {
  const secrets = await getCrmSecrets(clientId);
  if (!secrets) return { clientId, ok: false, leads: 0, error: "El cliente no tiene un CRM conectado." };

  try {
    const { leads, stages } = await readCrm(secrets);
    const db = createAdminClient();

    // Estado de cada oportunidad según las etapas que el equipo marcó como venta.
    const statuses = new Map(leads.map((l) => [l.externalId, crmStatusOf(l, secrets.won_stages)]));

    // Se conserva el id de los leads que ya estaban (el CRM manda external_id).
    // PostgREST corta en 1000 filas sin avisar: se lee de a páginas, porque un lead
    // que quede afuera se tomaría como nuevo y chocaría con el que ya existe.
    const existing: { id: string; external_id: string | null }[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error: readError } = await db
        .from("intranet_leads")
        .select("id, external_id")
        .eq("client_id", clientId)
        .order("id")
        .range(from, from + PAGE_SIZE - 1)
        .returns<{ id: string; external_id: string | null }[]>();
      if (readError) throw readError;
      existing.push(...(data ?? []));
      if ((data?.length ?? 0) < PAGE_SIZE) break;
    }

    const ids = new Map(existing.map((row) => [row.external_id, row.id]));

    if (leads.length) {
      const rows = leads.map((l) => ({
        id: ids.get(l.externalId) ?? randomUUID(),
        client_id: clientId,
        external_id: l.externalId,
        name: l.name,
        source: l.source,
        amount: l.amount,
        stage: l.stage,
        temperature: l.temperature,
        created_at: l.createdAt,
        // Columnas agregadas después (ver docs/sql/): si la base todavía no las
        // tiene, se guarda el resto en vez de perder el sync entero.
        status: statuses.get(l.externalId),
        owner: l.owner,
        ad: l.ad,
        tags: l.tags,
      }));

      // Se sacan de a tandas, de la más nueva a la más vieja, así una migración
      // pendiente no se lleva puestas columnas que ya existen.
      const sinColumnas = (columnas: string[]) =>
        rows.map((row) => {
          const copia: Record<string, unknown> = { ...row };
          for (const columna of columnas) delete copia[columna];
          return copia;
        });
      // El choque se resuelve por (cliente, id del CRM) y no por id: si dos syncs
      // corren a la vez, los dos dan de alta el mismo lead nuevo con ids distintos,
      // y el segundo tiene que actualizarlo en vez de fallar.
      const upsert = (batch: Record<string, unknown>[]) =>
        db.from("intranet_leads").upsert(batch, { onConflict: "client_id,external_id" });
      let { error } = await upsert(rows);
      if (error?.code === "42703") ({ error } = await upsert(sinColumnas(["tags"])));
      if (error?.code === "42703") ({ error } = await upsert(sinColumnas(["tags", "status", "owner", "ad"])));
      if (error) throw error;
    }

    // Lo que el CRM ya no devuelve (borrado o fuera del período) se saca.
    const vigentes = new Set(leads.map((l) => l.externalId));
    const sobran = existing.filter((row) => !vigentes.has(row.external_id ?? "")).map((row) => row.id);
    // Los ids van en la URL del DELETE: de a tandas, para no pasarse de largo.
    for (let i = 0; i < sobran.length; i += DELETE_BATCH) {
      const { error } = await db.from("intranet_leads").delete().in("id", sobran.slice(i, i + DELETE_BATCH));
      if (error) throw error;
    }

    // Snapshot del día: se reemplaza el de hoy si ya existía.
    const today = todayISO();
    const cerradas = leads.filter((l) => statuses.get(l.externalId) !== "open").length;
    const ganadas = leads.filter((l) => statuses.get(l.externalId) === "won").length;
    await db.from("intranet_crm_snapshot").delete().eq("client_id", clientId).eq("as_of", today);
    const { error: snapshotError } = await db.from("intranet_crm_snapshot").insert({
      id: randomUUID(),
      client_id: clientId,
      pipeline_value: leads
        .filter((l) => statuses.get(l.externalId) === "open")
        .reduce((total, l) => total + (l.amount ?? 0), 0),
      leads_count: leads.length,
      // Sobre las cerradas: qué porcentaje se ganó.
      conversion_rate: cerradas ? (ganadas * 100) / cerradas : 0,
      // WhatsApp es otra integración; acá no hay dato.
      active_chats: 0,
      as_of: today,
    });
    if (snapshotError) throw snapshotError;

    await saveCrmSecrets(clientId, {
      ...secrets,
      stage_order: stages.length ? stages : secrets.stage_order,
      synced_at: new Date().toISOString(),
      sync_error: null,
    });
    return { clientId, ok: true, leads: leads.length };
  } catch (e) {
    const detail = e instanceof Error ? e.message : ((e as { message?: string })?.message ?? "");
    console.error("[crm] sync", clientId, detail || e);
    const message = detail || "No se pudo leer el CRM.";
    await saveCrmSecrets(clientId, { ...secrets, sync_error: message }).catch(() => {});
    return { clientId, ok: false, leads: 0, error: message };
  }
}

export async function syncAllCrmClients(): Promise<CrmSyncResult[]> {
  const { data, error } = await createAdminClient()
    .from("intranet_client_integrations")
    .select("client_id")
    .eq("provider", "crm")
    .eq("connected", true)
    .returns<{ client_id: string }[]>();
  if (error) throw error;

  const results: CrmSyncResult[] = [];
  for (const row of data ?? []) results.push(await syncCrmClient(row.client_id));
  return results;
}

// Igual que en Meta: la primera vez se espera, después se refresca en segundo plano.
export async function prepareCrmView(clientId: string) {
  const secrets = await getCrmSecrets(clientId);
  if (!secrets) return null;

  if (!secrets.synced_at) {
    await syncCrmClient(clientId);
    return getCrmSecrets(clientId);
  }
  if (Date.now() - Date.parse(secrets.synced_at) > STALE_MS) after(() => syncCrmClient(clientId));
  return secrets;
}
