// Sincroniza el CRM de cada cliente a Supabase (intranet_leads +
// intranet_crm_snapshot). Solo server: usa service_role y las credenciales
// guardadas del CRM.
//
// Cada cliente puede usar un CRM distinto; el proveedor sale de los secrets.
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { crmExclusions, crmStatusOf, type CrmLead, type CrmProvider } from "./crm-shared";
import { todayISO } from "./format";
import { syncKommoChats } from "./crm-chat-sync";
import { readKommo, type KommoCredentials } from "./kommo";
import { getOdooOpportunities, getOdooStages, odooConnect, type OdooCredentials } from "./odoo";
import { matchSales, readSalesSheet } from "./sales-sheet";
import { createAdminClient, isMissingTable } from "./supabase/server";

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
  // Qué leads cuentan como oportunidad nueva (crmExclusions en lib/crm-shared.ts):
  // desde qué día el registro del CRM es completo y qué etapas no se cuentan.
  since?: string;
  excluded_stages?: string[];
  synced_at?: string;
  sync_error?: string | null;
  // Actividad de los chats (solo Kommo): el motivo si la última lectura falló.
  // Va aparte de sync_error: que fallen los chats no invalida las oportunidades.
  chat_error?: string | null;
  // Planilla de ventas confirmadas (lib/sales-sheet.ts). Con ella, la venta y su
  // monto salen de la planilla y no del CRM.
  sales_sheet?: { id: string; url: string; title?: string };
  // Va aparte de sync_error, como los chats: si la planilla falla se siguen
  // usando las ventas que ya estaban guardadas.
  sales_error?: string | null;
  sales_stats?: SalesStats;
};

// Resumen de la última lectura de la planilla, para la pantalla de conexión.
export type SalesStats = { projects: number; matched: number; noPhone: number; undated: number };

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

// Fila de intranet_crm_sales.
type SaleRow = {
  client_id: string;
  project: string;
  customer: string | null;
  confirmed_on: string;
  amount_ars: number | null;
  amount_usd: number | null;
  seller: string | null;
  channel: string | null;
  lead_external_id: string | null;
};

type Db = ReturnType<typeof createAdminClient>;

// Reemplaza las ventas guardadas del cliente por las de la planilla.
async function saveSales(db: Db, clientId: string, rows: SaleRow[]) {
  const existing: string[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from("intranet_crm_sales")
      .select("project")
      .eq("client_id", clientId)
      .order("project")
      .range(from, from + PAGE_SIZE - 1)
      .returns<{ project: string }[]>();
    if (error) throw error;
    existing.push(...(data ?? []).map((r) => r.project));
    if ((data?.length ?? 0) < PAGE_SIZE) break;
  }

  for (let i = 0; i < rows.length; i += PAGE_SIZE) {
    const { error } = await db
      .from("intranet_crm_sales")
      .upsert(rows.slice(i, i + PAGE_SIZE), { onConflict: "client_id,project" });
    if (error) throw error;
  }

  const current = new Set(rows.map((r) => r.project));
  const gone = existing.filter((p) => !current.has(p));
  for (let i = 0; i < gone.length; i += DELETE_BATCH) {
    const { error } = await db
      .from("intranet_crm_sales")
      .delete()
      .eq("client_id", clientId)
      .in("project", gone.slice(i, i + DELETE_BATCH));
    if (error) throw error;
  }
}

async function storedSales(db: Db, clientId: string) {
  const rows: SaleRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from("intranet_crm_sales")
      .select("*")
      .eq("client_id", clientId)
      .order("project")
      .range(from, from + PAGE_SIZE - 1)
      .returns<SaleRow[]>();
    if (error) {
      if (isMissingTable(error)) return rows;
      throw error;
    }
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE_SIZE) break;
  }
  return rows;
}

// Lee la planilla, cruza cada venta con su lead y la guarda. Nunca tira: si la
// planilla falla, devuelve las ventas que ya estaban guardadas y el motivo.
async function syncSales(
  db: Db,
  clientId: string,
  sheetId: string,
  leads: CrmLead[],
  excluded: Map<string, unknown>,
): Promise<{ rows: SaleRow[]; error: string | null; stats?: SalesStats }> {
  try {
    const { sales, undated } = await readSalesSheet(sheetId);
    const matches = matchSales(sales, leads, excluded);
    const rows: SaleRow[] = sales.map((s) => ({
      client_id: clientId,
      project: s.project,
      customer: s.customer,
      confirmed_on: s.confirmedOn,
      amount_ars: s.ars,
      amount_usd: s.usd,
      seller: s.seller,
      channel: s.channel,
      lead_external_id: matches.get(s.project) ?? null,
    }));
    const stats: SalesStats = {
      projects: sales.length,
      matched: matches.size,
      noPhone: sales.filter((s) => !s.phoneKey).length,
      undated,
    };
    try {
      await saveSales(db, clientId, rows);
    } catch (e) {
      // Lo leído se aplica igual a los leads; solo falta guardarlo.
      const message = isMissingTable(e as { code?: string })
        ? "Falta correr docs/sql/2026-10-06-ventas-planilla.sql en Supabase."
        : ((e as { message?: string })?.message ?? "No se pudieron guardar las ventas.");
      return { rows, error: message, stats };
    }
    return { rows, error: null, stats };
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudo leer la planilla.";
    console.error("[crm] planilla", clientId, message);
    return { rows: await storedSales(db, clientId).catch(() => []), error: message };
  }
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
    // Los que no son una oportunidad nueva: se guardan marcados y no entran en las métricas.
    const excluded = crmExclusions(leads, { since: secrets.since, excludedStages: secrets.excluded_stages });
    const counted = leads.filter((l) => !excluded.has(l.externalId));

    // Con planilla de ventas, ganada = tiene una venta en la planilla, y el monto
    // es el de esa venta (pesos y dólares por separado). Las etapas ganadas y los
    // presupuestos del CRM dejan de contar.
    const sales = secrets.sales_sheet ? await syncSales(db, clientId, secrets.sales_sheet.id, leads, excluded) : null;
    const sold = new Map<string, { ars: number | null; usd: number | null }>();
    for (const sale of sales?.rows ?? []) {
      if (!sale.lead_external_id) continue;
      const total = sold.get(sale.lead_external_id) ?? { ars: null, usd: null };
      if (sale.amount_ars) total.ars = (total.ars ?? 0) + Number(sale.amount_ars);
      if (sale.amount_usd) total.usd = (total.usd ?? 0) + Number(sale.amount_usd);
      sold.set(sale.lead_external_id, total);
    }
    if (sales) {
      for (const l of leads) statuses.set(l.externalId, sold.has(l.externalId) ? "won" : l.lost ? "lost" : "open");
    }

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
        amount: sales ? (sold.get(l.externalId)?.ars ?? null) : l.amount,
        stage: l.stage,
        temperature: l.temperature,
        created_at: l.createdAt,
        // Columnas agregadas después (ver docs/sql/): si la base todavía no las
        // tiene, se guarda el resto en vez de perder el sync entero.
        status: statuses.get(l.externalId),
        owner: l.owner,
        ad: l.ad,
        tags: l.tags,
        stage_changed_at: l.stageChangedAt,
        contact_created_at: l.contactCreatedAt,
        excluded: excluded.get(l.externalId) ?? null,
        // Solo la carga la planilla de ventas; sin ella queda vacía.
        amount_usd: sold.get(l.externalId)?.usd ?? null,
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
      // Columna inexistente: 42703 si responde Postgres, PGRST204 si PostgREST no
      // la tiene en su schema cache.
      const faltaColumna = (e: { code?: string } | null) => e?.code === "42703" || e?.code === "PGRST204";
      const tandas = [["amount_usd"], ["contact_created_at", "excluded"], ["stage_changed_at"], ["tags"], ["status", "owner", "ad"]];
      let { error } = await upsert(rows);
      for (let n = 1; n <= tandas.length && faltaColumna(error); n++) {
        ({ error } = await upsert(sinColumnas(tandas.slice(0, n).flat())));
      }
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
    const cerradas = counted.filter((l) => statuses.get(l.externalId) !== "open").length;
    const ganadas = counted.filter((l) => statuses.get(l.externalId) === "won").length;
    await db.from("intranet_crm_snapshot").delete().eq("client_id", clientId).eq("as_of", today);
    const { error: snapshotError } = await db.from("intranet_crm_snapshot").insert({
      id: randomUUID(),
      client_id: clientId,
      pipeline_value: counted
        .filter((l) => statuses.get(l.externalId) === "open")
        .reduce((total, l) => total + (l.amount ?? 0), 0),
      leads_count: counted.length,
      // Sobre las cerradas: qué porcentaje se ganó.
      conversion_rate: cerradas ? (ganadas * 100) / cerradas : 0,
      // WhatsApp es otra integración; acá no hay dato.
      active_chats: 0,
      as_of: today,
    });
    if (snapshotError) throw snapshotError;

    // Actividad de los chats: nunca tira, así un problema ahí no pierde el sync.
    const chats = secrets.provider === "kommo" && secrets.kommo ? await syncKommoChats(clientId, secrets.kommo, leads) : null;

    await saveCrmSecrets(clientId, {
      ...secrets,
      stage_order: stages.length ? stages : secrets.stage_order,
      synced_at: new Date().toISOString(),
      sync_error: null,
      chat_error: chats?.error ?? null,
      ...(sales ? { sales_error: sales.error, sales_stats: sales.stats ?? secrets.sales_stats } : {}),
    });
    return { clientId, ok: true, leads: counted.length };
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
