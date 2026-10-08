import { unstable_cache } from "next/cache";
import { cache } from "react";
import { initialsOf, type Profile } from "./auth-shared";
import type { ClientStatus } from "./client-status";
import { type CrmExclusion, isCrmExclusion } from "./crm-shared";
import { type HiddenTabs, parseHiddenTabs } from "./client-tabs";
import { INTEGRATIONS, type Integration, type IntegrationState } from "./integrations";
import { localDate } from "./format";
import { googlePhoto } from "./google-photo";
import { LOGOS_BUCKET, LOGOS_TAG } from "./logos";
import { getTickets, notionConfigured, notionErrorMessage } from "./notion";
import { type Period, toPeriod } from "./period";
import { EMPTY_PORTAL, parsePortal, type PortalSettings } from "./portal";
import { EMPTY_NOTION_CONFIG, isNotionConfigured, normalizeId, type NotionConfig } from "./notion-map";
import { createAdminClient, createClient, isMissingTable } from "./supabase/server";
import type { Task } from "./tasks";

export type { Integration } from "./integrations";

// Fila de intranet_settings donde vive la configuración de Notion.
export const NOTION_SETTINGS_KEY = "notion";

export type Client = {
  id: string;
  slug: string;
  name: string;
  sector: string | null;
  website: string | null;
  active: boolean;
  status: ClientStatus;
  initials: string;
  domain: string;
  logoUrl: string | null;
  assigneeIds: string[];
  conn: Record<Integration, boolean>;
  integrations: Record<Integration, IntegrationState>;
  // Solapas desactivadas en "Editar cliente", por zona (lib/client-tabs.ts).
  hiddenTabs: HiddenTabs;
};

type ClientRow = {
  id: string;
  slug: string;
  name: string;
  sector: string | null;
  website: string | null;
  active: boolean;
  status: ClientStatus;
  intranet_client_integrations: { provider: string; connected: boolean; account_ref: string | null; connected_at: string | null }[];
  intranet_client_assignments: { user_id: string }[];
  hidden_tabs?: unknown;
};

const CLIENT_COLUMNS =
  "id, slug, name, sector, website, active, status, intranet_client_integrations(provider, connected, account_ref, connected_at), intranet_client_assignments(user_id)";

// Logo de cada cliente: un objeto por cliente en el bucket, con nombre = client id.
// El bucket es público para leer; listar requiere service_role. El listado no
// depende del usuario, así que se cachea entre requests (si no, es una consulta a
// Storage en cada página) y las acciones que suben o borran logos lo invalidan.
const listLogos = unstable_cache(
  async (): Promise<[string, string][]> => {
    const storage = createAdminClient().storage.from(LOGOS_BUCKET);
    const { data, error } = await storage.list("", { limit: 1000 });
    // Tirar en vez de devolver [] para no cachear "sin logos" por un error puntual.
    if (error) throw error;
    return (data ?? [])
      .filter((f) => f.id)
      .map((f) => [f.name, `${storage.getPublicUrl(f.name).data.publicUrl}?v=${Date.parse(f.updated_at ?? "") || 0}`]);
  },
  ["client-logos"],
  { revalidate: 3600, tags: [LOGOS_TAG] },
);

const getLogoUrls = cache(async (): Promise<Map<string, string>> => new Map(await listLogos().catch(() => [])));

const toDomain = (website: string | null) =>
  (website ?? "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0];

// Todos los clientes (activos e inactivos) con su estado de integraciones.
// Usa la sesión del usuario: la RLS de intranet_clients decide qué ve cada uno.
export const getAllClients = cache(async (): Promise<Client[]> => {
  const supabase = await createClient();
  const read = (columns: string) =>
    supabase.from("intranet_clients").select(columns).order("name", { ascending: true }).returns<ClientRow[]>();
  const [first, logos] = await Promise.all([read(`${CLIENT_COLUMNS}, hidden_tabs`), getLogoUrls()]);
  // hidden_tabs llega con docs/sql/2026-09-28-solapas-cliente.sql: sin ella, todas visibles.
  const { data, error } = first.error?.code === "42703" ? await read(CLIENT_COLUMNS) : first;
  if (error) throw error;

  return (data ?? []).map(({ intranet_client_integrations: integrations, intranet_client_assignments: assignments, hidden_tabs, ...row }) => {
    const state = Object.fromEntries(
      INTEGRATIONS.map(({ value }) => {
        const row = integrations.find((i) => i.provider === value);
        return [value, { connected: !!row?.connected, accountRef: row?.account_ref ?? null, connectedAt: row?.connected_at ?? null }];
      }),
    ) as Record<Integration, IntegrationState>;
    return {
      ...row,
      initials: initialsOf(row.name),
      domain: toDomain(row.website),
      logoUrl: logos.get(row.id) ?? null,
      assigneeIds: assignments.map((a) => a.user_id),
      integrations: state,
      conn: Object.fromEntries(INTEGRATIONS.map(({ value }) => [value, state[value].connected])) as Record<Integration, boolean>,
      hiddenTabs: parseHiddenTabs(hidden_tabs),
    };
  });
});

// PostgREST devuelve como máximo 1000 filas por respuesta y no avisa que cortó.
// Las tablas que guardan una fila por día (métricas de Meta, leads del CRM) ya
// pasan ese tope, así que las lecturas grandes se traen de a páginas.
const PAGE_SIZE = 1000;

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

async function readAll<T>(page: (from: number, to: number) => Page<T>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE_SIZE) return rows;
  }
}

export const getClients = cache(async () => (await getAllClients()).filter((c) => c.active));

export const getClient = async (slug: string) => (await getAllClients()).find((c) => c.slug === slug) ?? null;


// ---------- Tareas (intranet_tasks + tickets de Notion) ----------

export type { Task, TaskPriority, TaskSource, TaskStatus } from "./tasks";
export { isLateTask, isOpenTask } from "./tasks";

type TaskRow = Omit<Task, "source" | "url">;

const getOwnTasks = async (): Promise<Task[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("intranet_tasks")
    .select("id, client_id, title, status, priority, assignee_id, due_date")
    .order("due_date", { ascending: true, nullsFirst: false })
    .returns<TaskRow[]>();
  if (error) throw error;
  return (data ?? []).map((t) => ({ ...t, source: "intranet" as const, url: null }));
};

// Resultado de leer Notion: las tareas y, si falló, el motivo para avisarlo en la UI.
export type TasksResult = { tasks: Task[]; notionError: string | null };

// Tickets de Notion ya mapeados a tareas de la intranet.
//
// La consulta a Notion se cachea aparte (getTickets) porque depende solo del
// token; el mapeo corre por request, con los clientes que la RLS deja ver a este
// usuario. Efecto colateral buscado: cada uno ve solo los tickets que le tocan.
async function getNotionTasks(): Promise<TasksResult> {
  const config = await getNotionConfig();
  if (!notionConfigured() || !isNotionConfigured(config)) return { tasks: [], notionError: null };

  // Proyecto de Notion → cliente de la intranet. Un proyecto por cliente.
  const clients = await getAllClients();
  const clientByProject = new Map<string, string>();
  for (const c of clients) {
    const ref = c.integrations.notion;
    if (ref.connected && ref.accountRef) clientByProject.set(normalizeId(ref.accountRef), c.id);
  }
  if (clientByProject.size === 0) return { tasks: [], notionError: null };

  let tickets;
  try {
    tickets = await getTickets(config);
  } catch (e) {
    // Nunca propagar: getTasks() corre en el layout de toda la app y un throw acá
    // dejaría la intranet entera en pantalla de error por un problema de Notion.
    console.error("[notion] getTickets", e);
    return { tasks: [], notionError: notionErrorMessage(e) };
  }

  const team = await getTeam();
  const profileByEmail = new Map(team.filter((m) => m.email).map((m) => [m.email!.toLowerCase(), m.id]));
  const profileByName = new Map(team.map((m) => [m.name.trim().toLowerCase(), m.id]));

  const tasks: Task[] = [];
  for (const ticket of tickets) {
    // Sin proyecto, o de un proyecto que no es de ningún cliente: se ignora.
    const clientId = ticket.projectIds.map((id) => clientByProject.get(id)).find(Boolean);
    if (!clientId) continue;

    // El responsable se cruza por email (todos son @qualita.studio); si Notion no
    // expone el email de la integración, se intenta por nombre.
    const assigneeId =
      ticket.peopleEmails.map((e) => profileByEmail.get(e.toLowerCase())).find(Boolean) ??
      ticket.peopleNames.map((n) => profileByName.get(n.trim().toLowerCase())).find(Boolean) ??
      null;

    tasks.push({
      id: ticket.id,
      client_id: clientId,
      title: ticket.title,
      status: ticket.status,
      priority: ticket.priority,
      assignee_id: assigneeId,
      due_date: ticket.dueDate,
      source: "notion",
      url: ticket.url,
    });
  }
  return { tasks, notionError: null };
}

// Tareas propias + tickets de Notion, ordenadas por vencimiento.
export const getTasksResult = cache(async (): Promise<TasksResult> => {
  const [own, notion] = await Promise.all([getOwnTasks(), getNotionTasks()]);
  const tasks = [...own, ...notion.tasks].sort((a, b) => {
    if (!a.due_date) return b.due_date ? 1 : 0;
    if (!b.due_date) return -1;
    return a.due_date.localeCompare(b.due_date);
  });
  return { tasks, notionError: notion.notionError };
});

export const getTasks = async (): Promise<Task[]> => (await getTasksResult()).tasks;

// ---------- Configuración de Notion (intranet_settings) ----------

export const getNotionConfig = cache(async (): Promise<NotionConfig | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("intranet_settings")
    .select("value")
    .eq("key", NOTION_SETTINGS_KEY)
    .maybeSingle<{ value: NotionConfig }>();
  // Tabla sin crear todavía o sin permisos: la app sigue andando sin Notion.
  if (error) return null;
  return data?.value ? { ...EMPTY_NOTION_CONFIG, ...data.value } : null;
});

// ---------- Portal del cliente (intranet_clients.portal) ----------

// Banner y responsable validador que carga el equipo. Con la sesión: la RLS de
// intranet_clients deja leer al equipo y a la cuenta del propio cliente.
// `missing`: falta correr docs/sql/2026-10-05-portal-intranet.sql.
export async function getPortalSettings(clientId: string): Promise<{ settings: PortalSettings; missing: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("intranet_clients")
    .select("portal")
    .eq("id", clientId)
    .maybeSingle<{ portal: unknown }>();
  if (error?.code === "42703") return { settings: EMPTY_PORTAL, missing: true };
  if (error) throw error;
  return { settings: parsePortal(data?.portal), missing: false };
}

// ---------- Meta (intranet_meta_daily / intranet_meta_ads) ----------

export type MetaDaily = {
  date: string;
  reach: number;
  impressions: number;
  clicks: number;
  spend: number;
  leads: number;
  conversions: number;
  revenue: number;
  followers: number | null;
  engagements: number | null;
};

export async function getMetaDaily(clientId: string, period: Period | number = 30): Promise<MetaDaily[]> {
  const { since, until } = toPeriod(period);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("intranet_meta_daily")
    .select("date, reach, impressions, clicks, spend, leads, conversions, revenue, followers, engagements")
    .eq("client_id", clientId)
    .gte("date", since)
    .lte("date", until)
    .order("date", { ascending: true })
    .returns<MetaDaily[]>();
  if (error) throw error;
  return (data ?? []).map((d) => ({ ...d, spend: Number(d.spend), revenue: Number(d.revenue) }));
}

// Primer día con métricas guardadas de un cliente. Dice si un período anterior
// está completo o si arranca antes de que hubiera datos (y no se puede comparar).
export async function getMetaFirstDate(clientId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("intranet_meta_daily")
    .select("date")
    .eq("client_id", clientId)
    .order("date", { ascending: true })
    .limit(1)
    .returns<{ date: string }[]>();
  if (error) throw error;
  return data?.[0]?.date ?? null;
}

// ---------- Google Ads (lib/google-ads-sync.ts las llena) ----------

export type GadsMetrics = { impressions: number; clicks: number; cost: number; conversions: number; conversions_value: number };
export type GadsDaily = GadsMetrics & { date: string };
export type GadsCampaign = GadsMetrics & { id: string; name: string; status: string | null; channel: string | null };

const GADS_METRICS = "impressions, clicks, cost, conversions, conversions_value";

// bigint y numeric llegan como texto o número según el tamaño: se normalizan.
const gadsMetrics = (r: Record<keyof GadsMetrics, unknown>): GadsMetrics => ({
  impressions: Number(r.impressions),
  clicks: Number(r.clicks),
  cost: Number(r.cost),
  conversions: Number(r.conversions),
  conversions_value: Number(r.conversions_value),
});

export async function getGadsDaily(clientId: string, period: Period | number = 30): Promise<GadsDaily[]> {
  const { since, until } = toPeriod(period);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("intranet_gads_daily")
    .select(`date, ${GADS_METRICS}`)
    .eq("client_id", clientId)
    .gte("date", since)
    .lte("date", until)
    .order("date", { ascending: true })
    .returns<(Record<keyof GadsMetrics, unknown> & { date: string })[]>();
  if (error) throw error;
  return (data ?? []).map((d) => ({ date: d.date, ...gadsMetrics(d) }));
}

// Primer día guardado: dice si el período anterior está completo para comparar.
export async function getGadsFirstDate(clientId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("intranet_gads_daily")
    .select("date")
    .eq("client_id", clientId)
    .order("date", { ascending: true })
    .limit(1)
    .returns<{ date: string }[]>();
  if (error) throw error;
  return data?.[0]?.date ?? null;
}

// Campañas con actividad en el período, sumadas, de mayor a menor gasto. Nombre,
// estado y tipo salen del día más reciente.
export async function getGadsCampaigns(clientId: string, period: Period | number = 30): Promise<GadsCampaign[]> {
  const { since, until } = toPeriod(period);
  const supabase = await createClient();
  const rows: (Record<keyof GadsMetrics, unknown> & { campaign_id: string; date: string; name: string; status: string | null; channel: string | null })[] = [];
  // PostgREST corta en 1000 filas: se pagina (campañas × días puede pasarlas).
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("intranet_gads_campaigns")
      .select(`campaign_id, date, name, status, channel, ${GADS_METRICS}`)
      .eq("client_id", clientId)
      .gte("date", since)
      .lte("date", until)
      .order("date", { ascending: true })
      .order("campaign_id", { ascending: true })
      .range(from, from + 999)
      .returns<typeof rows>();
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  const byId = new Map<string, GadsCampaign>();
  for (const r of rows) {
    const m = gadsMetrics(r);
    const prev = byId.get(r.campaign_id);
    byId.set(r.campaign_id, {
      id: r.campaign_id,
      name: r.name,
      status: r.status,
      channel: r.channel,
      impressions: (prev?.impressions ?? 0) + m.impressions,
      clicks: (prev?.clicks ?? 0) + m.clicks,
      cost: (prev?.cost ?? 0) + m.cost,
      conversions: (prev?.conversions ?? 0) + m.conversions,
      conversions_value: (prev?.conversions_value ?? 0) + m.conversions_value,
    });
  }
  return [...byId.values()].sort((a, b) => b.cost - a.cost);
}

export type MetaAd = {
  id: string;
  name: string;
  status: string;
  spend: number;
  leads: number;
  clicks: number;
  impressions: number;
  revenue: number;
  as_of: string;
  // Id del anuncio en Meta (para pedir la vista previa); null en campañas y en
  // filas viejas sin id.
  externalId: string | null;
  // Tipo y miniatura del creativo; null si todavía no se sincronizó.
  creative: AdCreativeInfo | null;
};

export type AdCreativeInfo = { type: "video" | "image" | "other"; thumbnail: string | null };

export type MetaCampaign = MetaAd & { ads: MetaAd[] };

// Creativos de los anuncios del cliente (los escribe lib/meta-sync.ts). Si la
// tabla todavía no existe, la vista sigue sin miniaturas en vez de romperse.
async function getMetaCreatives(clientId: string): Promise<Map<string, AdCreativeInfo>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("intranet_meta_creatives")
    .select("ad_external_id, creative_type, thumbnail_url")
    .eq("client_id", clientId)
    .returns<{ ad_external_id: string; creative_type: AdCreativeInfo["type"]; thumbnail_url: string | null }[]>();
  if (error && !isMissingTable(error)) throw error;
  return new Map((data ?? []).map((c) => [c.ad_external_id, { type: c.creative_type, thumbnail: c.thumbnail_url }]));
}

type MetaAdRow = Omit<MetaAd, "externalId" | "creative"> & {
  ad_external_id: string | null;
  campaign_external_id: string | null;
  campaign_name: string | null;
};

// Anuncios sincronizados antes de que se guardara la campaña.
const NO_CAMPAIGN = "sin-campana";

const addTotals = (target: MetaAd, row: MetaAdRow) => {
  target.spend += Number(row.spend);
  target.revenue += Number(row.revenue);
  target.leads += row.leads;
  target.clicks += row.clicks;
  target.impressions += row.impressions;
};

// El sync guarda una fila por anuncio y por día; acá se suman las del período y
// se agrupan por campaña. Nombre, estado y as_of salen de la fila más reciente
// (la query viene ordenada por as_of descendente); una campaña está activa si
// alguno de sus anuncios lo está.
export async function getMetaCampaigns(clientId: string, period: Period | number = 30): Promise<MetaCampaign[]> {
  const { since, until } = toPeriod(period);
  const supabase = await createClient();
  const [rows, creatives] = await Promise.all([
    readAll<MetaAdRow>((from, to) =>
      supabase
        .from("intranet_meta_ads")
        .select(
          "id, ad_external_id, name, status, spend, leads, clicks, impressions, revenue, as_of, campaign_external_id, campaign_name",
        )
        .eq("client_id", clientId)
        .gte("as_of", since)
        .lte("as_of", until)
        .order("as_of", { ascending: false })
        .range(from, to)
        .returns<MetaAdRow[]>(),
    ),
    getMetaCreatives(clientId),
  ]);

  const campaigns = new Map<string, MetaCampaign>();
  const ads = new Map<string, MetaAd>();

  for (const row of rows) {
    const campaignId = row.campaign_external_id ?? NO_CAMPAIGN;
    const adId = row.ad_external_id ?? row.id;

    let campaign = campaigns.get(campaignId);
    if (!campaign) {
      campaign = {
        id: campaignId,
        name: row.campaign_name ?? "Sin campaña",
        status: "pausado",
        spend: 0,
        leads: 0,
        clicks: 0,
        impressions: 0,
        revenue: 0,
        as_of: row.as_of,
        externalId: null,
        creative: null,
        ads: [],
      };
      campaigns.set(campaignId, campaign);
    }

    let ad = ads.get(adId);
    if (!ad) {
      ad = {
        id: adId,
        name: row.name,
        status: row.status,
        spend: 0,
        leads: 0,
        clicks: 0,
        impressions: 0,
        revenue: 0,
        as_of: row.as_of,
        externalId: row.ad_external_id,
        creative: (row.ad_external_id && creatives.get(row.ad_external_id)) || null,
      };
      ads.set(adId, ad);
      campaign.ads.push(ad);
    }

    addTotals(ad, row);
    addTotals(campaign, row);
    if (ad.status === "activo") campaign.status = "activo";
  }

  const bySpend = (a: MetaAd, b: MetaAd) => b.spend - a.spend;
  return [...campaigns.values()].map((c) => ({ ...c, ads: c.ads.sort(bySpend) })).sort(bySpend);
}

// ---------- CRM (intranet_crm_snapshot / intranet_leads) ----------

export type CrmSnapshot = {
  pipeline_value: number;
  leads_count: number;
  conversion_rate: number;
  active_chats: number;
  as_of: string;
};

export async function getCrmSnapshot(clientId: string): Promise<CrmSnapshot | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("intranet_crm_snapshot")
    .select("pipeline_value, leads_count, conversion_rate, active_chats, as_of")
    .eq("client_id", clientId)
    .order("as_of", { ascending: false })
    .limit(1)
    .maybeSingle<CrmSnapshot>();
  if (error) throw error;
  return data && { ...data, pipeline_value: Number(data.pipeline_value), conversion_rate: Number(data.conversion_rate) };
}

export type Lead = {
  id: string;
  // Id de la oportunidad en el CRM: cruza con los chats (intranet_crm_chat_events).
  external_id: string | null;
  name: string;
  source: string | null;
  amount: number | null;
  stage: string | null;
  temperature: string | null;
  created_at: string;
  // 'open' | 'won' | 'lost', según el CRM.
  status: string | null;
  // Vendedor a cargo, como lo nombra el CRM.
  owner: string | null;
  // Anuncio que originó la oportunidad.
  ad: string | null;
  // Etiquetas del CRM. null = la base todavía no tiene la columna: no es lo
  // mismo que una oportunidad sin etiquetas, y el agente tiene que distinguirlo.
  tags: string[] | null;
  // Último cambio de etapa (solo Odoo); null si el CRM no lo informa.
  stage_changed_at: string | null;
  // Parte en dólares de la venta, solo con planilla de ventas (`amount` lleva la
  // parte en pesos).
  amount_usd: number | null;
};

const LEAD_COLUMNS = "id, external_id, name, source, amount, stage, temperature, created_at";
// Columnas agregadas después (ver docs/sql/), de a tandas y de la más vieja a la
// más nueva: mientras la base no tenga alguna, se lee sin ella (y sin las
// posteriores) en vez de romper.
const LEAD_EXTRA_COLUMNS = [["status", "owner", "ad"], ["tags"], ["stage_changed_at"], ["excluded"], ["amount_usd"]];

// Fila como está guardada: `excluded` trae el motivo de los leads que no cuentan
// como oportunidad nueva (crmExclusions en lib/crm-shared.ts).
type LeadRow = Lead & { excluded?: string | null };

const readLeadRows = cache(async (clientId: string): Promise<LeadRow[]> => {
  const supabase = await createClient();
  const read = (columns: string) =>
    readAll<LeadRow>((from, to) =>
      supabase
        .from("intranet_leads")
        .select(columns)
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .range(from, to)
        .returns<LeadRow[]>(),
    );

  let data: LeadRow[] | null = null;
  for (let tandas = LEAD_EXTRA_COLUMNS.length; data === null; tandas--) {
    const columns = [LEAD_COLUMNS, ...LEAD_EXTRA_COLUMNS.slice(0, tandas).flat()].join(", ");
    data = await read(columns).catch((e) => {
      if (tandas === 0 || (e as { code?: string })?.code !== "42703") throw e;
      return null;
    });
  }
  return data;
});

// Leads que el CRM tiene cargados pero no cuentan como oportunidad nueva, con el
// motivo: la vista de CRM avisa cuántos quedaron afuera del período.
export async function getExcludedLeads(clientId: string): Promise<{ created_at: string; excluded: CrmExclusion }[]> {
  return (await readLeadRows(clientId)).flatMap((l) =>
    isCrmExclusion(l.excluded) ? [{ created_at: l.created_at, excluded: l.excluded }] : [],
  );
}

// Las oportunidades del cliente. Solo las que cuentan: pruebas internas, leads
// anteriores al arranque del CRM, clientes que ya estaban y duplicados quedan
// afuera de todas las vistas, del agente y de los reportes.
export async function getLeads(clientId: string): Promise<Lead[]> {
  const data = (await readLeadRows(clientId)).filter((l) => !l.excluded);
  return data.map((l) => ({
    ...l,
    status: l.status ?? null,
    owner: l.owner ?? null,
    ad: l.ad ?? null,
    tags: l.tags ?? null,
    stage_changed_at: l.stage_changed_at ?? null,
    amount: l.amount === null ? null : Number(l.amount),
    amount_usd: l.amount_usd === null || l.amount_usd === undefined ? null : Number(l.amount_usd),
  }));
}

// ---------- Ventas desde la planilla (intranet_crm_sales) ----------

// Un proyecto confirmado según la planilla de ventas del cliente (lib/sales-sheet.ts).
export type Sale = {
  project: string;
  customer: string | null;
  confirmed_on: string;
  amount_ars: number | null;
  amount_usd: number | null;
  seller: string | null;
  channel: string | null;
  // Lead del CRM que la originó; null si ninguno tiene el mismo teléfono.
  lead_external_id: string | null;
};

// Las ventas de la planilla. null si la tabla todavía no existe.
export const getSales = cache(async (clientId: string): Promise<Sale[] | null> => {
  const supabase = await createClient();
  try {
    const rows = await readAll<Sale>((from, to) =>
      supabase
        .from("intranet_crm_sales")
        .select("project, customer, confirmed_on, amount_ars, amount_usd, seller, channel, lead_external_id")
        .eq("client_id", clientId)
        .order("confirmed_on", { ascending: false })
        .order("project")
        .range(from, to)
        .returns<Sale[]>(),
    );
    return rows.map((s) => ({
      ...s,
      amount_ars: s.amount_ars === null ? null : Number(s.amount_ars),
      amount_usd: s.amount_usd === null ? null : Number(s.amount_usd),
    }));
  } catch (e) {
    if (isMissingTable(e as { code?: string })) return null;
    throw e;
  }
});

// Total y promedio de una moneda, sobre las ventas que tienen esa parte: un
// proyecto solo en pesos no baja el promedio en dólares.
export type CurrencyStats = { total: number; count: number; avg: number | null };

function currencyStats(amounts: (number | null)[]): CurrencyStats {
  const values = amounts.filter((a): a is number => a !== null && a > 0);
  const total = values.reduce((sum, a) => sum + a, 0);
  return { total, count: values.length, avg: values.length ? total / values.length : null };
}

export type SaleSellerStats = { name: string; sales: number; ars: CurrencyStats; usd: CurrencyStats };

export type SaleSourceStats = { name: string; sales: number; share: number; ars: number; usd: number };

// Origen de las ventas que no vienen de una oportunidad contada del CRM.
export const NO_CRM_LEAD = "Sin oportunidad en el CRM";

// Corte por período de las ventas, por fecha de confirmación (no por la del lead,
// así la facturación del mes es la de lo que se vendió en el mes). El origen sale
// del lead del CRM con el mismo teléfono.
export function salesPeriod(sales: Sale[], leads: Lead[], period: Period | number) {
  const { since, until } = toPeriod(period);
  const inPeriod = sales.filter((s) => s.confirmed_on >= since && s.confirmed_on <= until);
  const leadOf = new Map(leads.map((l) => [l.external_id, l]));

  const bySeller = new Map<string, Sale[]>();
  const bySource = new Map<string, Sale[]>();
  for (const sale of inPeriod) {
    const seller = sale.seller ?? UNASSIGNED;
    bySeller.set(seller, [...(bySeller.get(seller) ?? []), sale]);
    const lead = sale.lead_external_id ? leadOf.get(sale.lead_external_id) : undefined;
    const source = lead ? lead.source?.trim() || "Sin origen" : NO_CRM_LEAD;
    bySource.set(source, [...(bySource.get(source) ?? []), sale]);
  }

  const total = inPeriod.length || 1;
  const sum = (list: Sale[], key: "amount_ars" | "amount_usd") => list.reduce((t, s) => t + (s[key] ?? 0), 0);
  const last = (name: string) => name === NO_CRM_LEAD || name === "Sin origen";

  return {
    sales: inPeriod,
    // Ventas que no se pudieron atribuir a una oportunidad del CRM.
    unattributed: inPeriod.filter((s) => !s.lead_external_id || !leadOf.has(s.lead_external_id)).length,
    ars: currencyStats(inPeriod.map((s) => s.amount_ars)),
    usd: currencyStats(inPeriod.map((s) => s.amount_usd)),
    sellers: [...bySeller.entries()]
      .map(([name, list]): SaleSellerStats => ({
        name,
        sales: list.length,
        ars: currencyStats(list.map((s) => s.amount_ars)),
        usd: currencyStats(list.map((s) => s.amount_usd)),
      }))
      .sort((a, b) => b.ars.total - a.ars.total || b.sales - a.sales),
    sources: [...bySource.entries()]
      .map(([name, list]): SaleSourceStats => ({
        name,
        sales: list.length,
        share: (list.length * 100) / total,
        ars: sum(list, "amount_ars"),
        usd: sum(list, "amount_usd"),
      }))
      .sort((a, b) => Number(last(a.name)) - Number(last(b.name)) || b.sales - a.sales),
  };
}

// Cómo llega un lead desde la publicidad de Meta, según la fuente del CRM.
const META_SOURCE = /meta|facebook|instagram/i;

export type SellerStats = {
  name: string;
  leads: number;
  won: number;
  tickets: number;
  ticketAvg: number | null;
  ticketTotal: number;
};

const UNASSIGNED = "Sin asignar";

// En el CRM los vendedores suelen tener un prefijo repetido ("Venta a medida
// Camila"): si lo comparten todos, ocupa lugar sin distinguir a nadie y se saca.
// Se compara por palabras para no cortar un nombre por la mitad, y siempre queda
// al menos una.
function stripSharedPrefix(names: string[]) {
  const real = names.filter((n) => n !== UNASSIGNED).map((n) => n.split(" "));
  if (real.length < 2) return new Map<string, string>();

  let shared = 0;
  while (real.every((words) => words.length > shared + 1 && words[shared] === real[0][shared])) shared++;
  if (!shared) return new Map<string, string>();

  return new Map(real.map((words) => [words.join(" "), words.slice(shared).join(" ")]));
}

// Rendimiento por vendedor. El ticket promedio sale de las ventas que lo tienen
// cargado, igual que el KPI: las vacías no cuentan como cero.
function groupSellers(leads: Lead[]): SellerStats[] {
  const bySeller = new Map<string, SellerStats>();

  for (const lead of leads) {
    const name = lead.owner ?? UNASSIGNED;
    const seller = bySeller.get(name) ?? { name, leads: 0, won: 0, tickets: 0, ticketAvg: null, ticketTotal: 0 };
    seller.leads += 1;
    if (lead.status === "won") seller.won += 1;
    if (lead.amount && lead.amount > 0) {
      seller.tickets += 1;
      seller.ticketTotal += lead.amount;
    }
    bySeller.set(name, seller);
  }

  const shortNames = stripSharedPrefix([...bySeller.keys()]);
  return [...bySeller.values()]
    .map((s) => ({
      ...s,
      name: shortNames.get(s.name) ?? s.name,
      ticketAvg: s.tickets ? s.ticketTotal / s.tickets : null,
    }))
    .sort((a, b) => b.ticketTotal - a.ticketTotal || b.leads - a.leads);
}

// usdTotal: la parte en dólares de las ventas, solo con planilla de ventas.
export type AdStats = { name: string; leads: number; won: number; tickets: number; ticketTotal: number; usdTotal: number };

// Rendimiento por anuncio. Solo entran las oportunidades que traen el anuncio
// cargado: el resto no se puede atribuir y contarlas como "sin anuncio" mezclaría
// las que vinieron por otro canal con las que nadie completó.
function groupAds(leads: Lead[]): AdStats[] {
  const byAd = new Map<string, AdStats>();

  for (const lead of leads) {
    const name = lead.ad?.trim();
    if (!name) continue;
    const ad = byAd.get(name) ?? { name, leads: 0, won: 0, tickets: 0, ticketTotal: 0, usdTotal: 0 };
    ad.leads += 1;
    if (lead.status === "won") ad.won += 1;
    if (lead.amount && lead.amount > 0) {
      ad.tickets += 1;
      ad.ticketTotal += lead.amount;
    }
    if (lead.amount_usd && lead.amount_usd > 0) ad.usdTotal += lead.amount_usd;
    byAd.set(name, ad);
  }

  return [...byAd.values()].sort((a, b) => b.leads - a.leads || b.ticketTotal - a.ticketTotal);
}

const adTokens = (name: string) => name.trim().toUpperCase().split(/[\s_-]+/).filter(Boolean);

// ¿El nombre corto del CRM es este anuncio de Meta? Sus partes tienen que estar en
// el nombre de Meta en el mismo orden, y la última (la variante: WEB02, RTG01)
// tiene que ser también la última del de Meta.
function isShortNameOf(crm: string[], meta: string[]) {
  if (!crm.length || crm.at(-1) !== meta.at(-1)) return false;
  let i = 0;
  for (const token of meta) if (token === crm[i]) i++;
  return i === crm.length;
}

// El CRM no siempre guarda el nombre completo del anuncio: en Arteplac, Kommo
// recibe "TESTIMONIAL_WEB02" por un anuncio que en Meta se llama
// "ATP_COC_A01_D07_TESTIMONIAL_VID_V01_WEB02". Cada anuncio del CRM pasa a llevar
// el nombre de Meta: exacto (sin distinguir mayúsculas) o, si no, el anuncio
// corto que lo contiene; entre varios, el de más gasto. Los que no aparecen en
// Meta (Google Ads, ids sueltos) quedan como estaban. Varios nombres del CRM
// pueden caer en el mismo anuncio: se suman.
export function withMetaAdNames(crmAds: AdStats[], metaAds: MetaAd[]): AdStats[] {
  const spend = new Map<string, number>();
  for (const ad of metaAds) spend.set(ad.name.trim(), (spend.get(ad.name.trim()) ?? 0) + ad.spend);
  const meta = [...spend.keys()].map((name) => ({ name, tokens: adTokens(name) }));

  const merged = new Map<string, AdStats>();
  for (const stats of crmAds) {
    const tokens = adTokens(stats.name);
    const exact = meta.find((m) => m.tokens.join("_") === tokens.join("_"));
    const short = exact
      ? null
      : meta
          .filter((m) => isShortNameOf(tokens, m.tokens))
          .sort((a, b) => (spend.get(b.name) ?? 0) - (spend.get(a.name) ?? 0))[0];
    const name = (exact ?? short)?.name ?? stats.name;
    const into = merged.get(name);
    merged.set(
      name,
      into
        ? {
            name,
            leads: into.leads + stats.leads,
            won: into.won + stats.won,
            tickets: into.tickets + stats.tickets,
            ticketTotal: into.ticketTotal + stats.ticketTotal,
            usdTotal: into.usdTotal + stats.usdTotal,
          }
        : { ...stats, name },
    );
  }
  return [...merged.values()].sort((a, b) => b.leads - a.leads || b.ticketTotal - a.ticketTotal);
}

export type SourceStats = { name: string; leads: number; share: number; ticketTotal: number };

// De dónde vienen las oportunidades (o las ventas, si se le pasan solo las
// ganadas). "Sin origen" va último y aparte: en el CRM el campo es opcional y
// suele quedar vacío, así que conviene verlo separado.
function groupSources(leads: Lead[]): SourceStats[] {
  const bySource = new Map<string, { leads: number; ticketTotal: number }>();
  for (const lead of leads) {
    const name = lead.source?.trim() || "Sin origen";
    const source = bySource.get(name) ?? { leads: 0, ticketTotal: 0 };
    source.leads += 1;
    if (lead.amount && lead.amount > 0) source.ticketTotal += lead.amount;
    bySource.set(name, source);
  }

  const total = leads.length || 1;
  return [...bySource.entries()]
    .map(([name, s]) => ({ name, ...s, share: (s.leads * 100) / total }))
    .sort((a, b) => {
      if (a.name === "Sin origen") return 1;
      if (b.name === "Sin origen") return -1;
      return b.leads - a.leads;
    });
}

export type TagStats = { name: string; leads: number; won: number; ticketTotal: number };

// Oportunidades por etiqueta. Una oportunidad puede tener varias, así que la
// suma de las filas no da el total de oportunidades.
function groupTags(leads: Lead[]): TagStats[] | null {
  if (leads.some((l) => l.tags === null)) return null;
  const byTag = new Map<string, TagStats>();
  for (const lead of leads) {
    for (const name of lead.tags ?? []) {
      const tag = byTag.get(name) ?? { name, leads: 0, won: 0, ticketTotal: 0 };
      tag.leads += 1;
      if (lead.status === "won") tag.won += 1;
      if (lead.amount && lead.amount > 0) tag.ticketTotal += lead.amount;
      byTag.set(name, tag);
    }
  }
  return [...byTag.values()].sort((a, b) => b.leads - a.leads);
}

// Corte por período para la vista de CRM: qué leads entran y qué se calcula
// sobre ellos, siempre por fecha de creación.
export function crmPeriod(leads: Lead[], period: Period | number) {
  const { since, until } = toPeriod(period);
  const inPeriod = leads.filter((l) => {
    const day = localDate(l.created_at);
    return day >= since && day <= until;
  });
  // Sin la columna de estado no se puede saber qué pasó con cada lead.
  const hasStatus = leads.some((l) => l.status);
  const closed = inPeriod.filter((l) => l.status === "won" || l.status === "lost").length;
  const won = inPeriod.filter((l) => l.status === "won").length;
  // En el CRM el origen es opcional: el porcentaje se calcula sobre las que lo
  // tienen cargado, no sobre el total, que daría un número diluido.
  const withSource = inPeriod.filter((l) => l.source).length;

  // El ticket lo carga el vendedor al cerrar la venta, así que promedia solo
  // sobre las que lo tienen: contar las vacías como cero hundiría el número.
  const tickets = inPeriod.map((l) => l.amount).filter((a): a is number => a !== null && a > 0);

  return {
    leads: inPeriod,
    won: hasStatus ? won : null,
    conversion: hasStatus && closed ? (won * 100) / closed : null,
    withSource,
    fromMeta: inPeriod.filter((l) => l.source && META_SOURCE.test(l.source)).length,
    tickets: tickets.length,
    ticketAvg: tickets.length ? tickets.reduce((total, t) => total + t, 0) / tickets.length : null,
    ticketTotal: tickets.reduce((total, t) => total + t, 0),
    sellers: groupSellers(inPeriod),
    sources: groupSources(inPeriod),
    // Sin la columna de estado no hay forma de saber cuáles son ventas.
    wonSources: hasStatus ? groupSources(inPeriod.filter((l) => l.status === "won")) : null,
    ads: groupAds(inPeriod),
    tags: groupTags(inPeriod),
  };
}

const STAGE_ORDER = ["Nuevos", "Contactados", "Propuesta", "Negociación", "Cerrados"];

// Embudo a partir de los leads. El orden lo manda el CRM cuando lo informa
// (`order`); si no, se usan las etapas conocidas y el resto va al final.
export function leadFunnel(leads: Lead[], order: string[] = STAGE_ORDER) {
  const counts = new Map<string, number>();
  for (const l of leads) {
    const stage = l.stage || "Sin etapa";
    counts.set(stage, (counts.get(stage) ?? 0) + 1);
  }
  const rank = (s: string) => {
    const i = order.indexOf(s);
    return i === -1 ? order.length : i;
  };
  return [...counts.entries()]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([name, value]) => ({ name, value }));
}

// ---------- Equipo ----------

// jobTitle: puesto (Diseñador, Project manager…). Lo define un admin y es solo
// para mostrar; los permisos siguen saliendo de role + areas.
export type TeamMember = Profile & { name: string; avatarUrl: string | null; invited: boolean; jobTitle: string | null };

// Miembros del equipo con su foto de Google. Usa service_role (RLS solo deja ver
// el propio perfil a los members): llamar únicamente después de validar canAccess.
export const getTeam = cache(async (): Promise<TeamMember[]> => {
  const admin = createAdminClient();
  const [{ data: profiles, error }, { data: authUsers }] = await Promise.all([
    admin
      .from("intranet_profiles")
      // "*" y no la lista de columnas: job_title llega con
      // docs/sql/2026-09-26-perfil-puesto.sql y, mientras no se corra, pedirla
      // por nombre rompería toda pantalla que lista al equipo.
      .select("*")
      .order("email", { ascending: true })
      .returns<(Profile & { job_title?: string | null })[]>(),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ]);
  if (error) throw error;

  const users = new Map((authUsers?.users ?? []).map((u) => [u.id, u]));

  return Promise.all(
    (profiles ?? []).map(async ({ id, email, full_name, role, areas, active, job_title }) => {
      const p = { id, email, full_name, role, areas, active };
      const user = users.get(p.id);
      const meta = user?.user_metadata ?? {};
      return {
        ...p,
        jobTitle: job_title?.trim() || null,
        name: meta.full_name || meta.name || p.full_name || p.email?.split("@")[0] || "Sin nombre",
        // Si el login no trajo la foto, se pide a Google (solo activos: un dado de
        // baja puede no existir más en Workspace).
        avatarUrl: meta.avatar_url || meta.picture || (p.active ? await googlePhoto(p.email) : null),
        // Alta hecha desde Administración que todavía no ingresó con Google.
        invited: !user?.last_sign_in_at,
      };
    }),
  );
});

// Equipo asignado a un cliente (intranet_client_assignments), solo los activos.
// Service_role porque la cuenta del cliente no ve asignaciones ni perfiles:
// llamar solo después de validar que quien pide puede ver ese cliente.
export async function getClientTeam(clientId: string): Promise<TeamMember[]> {
  const [{ data, error }, team] = await Promise.all([
    createAdminClient().from("intranet_client_assignments").select("user_id").eq("client_id", clientId),
    getTeam(),
  ]);
  if (error) throw error;
  const assigned = new Set((data ?? []).map((a: { user_id: string }) => a.user_id));
  return team.filter((m) => m.active && assigned.has(m.id)).sort((a, b) => a.name.localeCompare(b.name, "es"));
}

// ---------- Clarity (intranet_clarity_daily / intranet_clarity_pages) ----------

export type ClarityDaily = {
  as_of: string;
  sessions: number;
  bot_sessions: number;
  distinct_users: number;
  pages_per_session: number | null;
  scroll_depth: number | null;
  total_time: number | null;
  active_time: number | null;
  rage_clicks: number;
  dead_clicks: number;
  excessive_scroll: number;
  quickbacks: number;
  script_errors: number;
  error_clicks: number;
  devices: { name: string; sessions: number }[];
};

// Serie diaria de Clarity. Arranca en la primera sincronización: la API solo
// entrega los últimos 3 días, así que no hay historial anterior que traer.
export async function getClarityDaily(clientId: string, days = 30): Promise<ClarityDaily[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("intranet_clarity_daily")
    .select(
      "as_of, sessions, bot_sessions, distinct_users, pages_per_session, scroll_depth, total_time, active_time, rage_clicks, dead_clicks, excessive_scroll, quickbacks, script_errors, error_clicks, devices",
    )
    .eq("client_id", clientId)
    .gte("as_of", since)
    .order("as_of", { ascending: true })
    .returns<ClarityDaily[]>();
  if (error) throw error;
  return (data ?? []).map((d) => ({
    ...d,
    pages_per_session: d.pages_per_session === null ? null : Number(d.pages_per_session),
    scroll_depth: d.scroll_depth === null ? null : Number(d.scroll_depth),
    total_time: d.total_time === null ? null : Number(d.total_time),
    active_time: d.active_time === null ? null : Number(d.active_time),
    devices: d.devices ?? [],
  }));
}

export type ClarityPage = { url: string; sessions: number };

// Páginas más vistas del período, sumadas entre los días guardados.
export async function getClarityPages(clientId: string, days = 30): Promise<ClarityPage[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const supabase = await createClient();
  const rows = await readAll<ClarityPage>((from, to) =>
    supabase
      .from("intranet_clarity_pages")
      .select("url, sessions")
      .eq("client_id", clientId)
      .gte("as_of", since)
      .range(from, to)
      .returns<ClarityPage[]>(),
  );

  const byUrl = new Map<string, number>();
  for (const row of rows) byUrl.set(row.url, (byUrl.get(row.url) ?? 0) + row.sessions);
  return [...byUrl.entries()]
    .map(([url, sessions]) => ({ url, sessions }))
    .sort((a, b) => b.sessions - a.sessions);
}

// ---------- Mejores videos (card del CRM) ----------

export type VideoPerformance = {
  ad: MetaAd;
  // Resultados según el CRM (oportunidades que traen este anuncio cargado).
  crmLeads: number;
  won: number;
  ticketTotal: number;
  usdTotal: number;
  // Resultados según Meta, sumando todos los anuncios con ese nombre.
  spend: number;
  metaLeads: number;
  clicks: number;
  impressions: number;
};

// Los videos que mejor rindieron en el período. El CRM identifica el anuncio por
// nombre, y en Meta es común duplicar un anuncio en varios conjuntos con el mismo
// nombre: por eso se agrupa por nombre, sumando el gasto de todas las copias, y
// la miniatura y la vista previa salen de la copia con más gasto.
//
// Orden: ventas ganadas, después oportunidades, después facturado (lo que el CRM
// sabe y Meta no). Si ningún video tiene oportunidades atribuidas en el CRM, se
// ordena por los leads que reporta Meta, y `by` lo indica para decirlo en la card.
export function topVideoAds(campaigns: MetaCampaign[], crmAds: AdStats[], limit = 3) {
  const byName = new Map<string, VideoPerformance>();
  for (const ad of campaigns.flatMap((c) => c.ads)) {
    if (ad.creative?.type !== "video") continue;
    const name = ad.name.trim();
    const v = byName.get(name) ?? {
      ad,
      crmLeads: 0,
      won: 0,
      ticketTotal: 0,
      usdTotal: 0,
      spend: 0,
      metaLeads: 0,
      clicks: 0,
      impressions: 0,
    };
    if (ad.spend > v.ad.spend) v.ad = ad;
    v.spend += ad.spend;
    v.metaLeads += ad.leads;
    v.clicks += ad.clicks;
    v.impressions += ad.impressions;
    byName.set(name, v);
  }

  for (const stats of crmAds) {
    const v = byName.get(stats.name.trim());
    if (!v) continue;
    v.crmLeads = stats.leads;
    v.won = stats.won;
    v.ticketTotal = stats.ticketTotal;
    v.usdTotal = stats.usdTotal;
  }

  const videos = [...byName.values()];
  const by: "crm" | "meta" = videos.some((v) => v.crmLeads > 0) ? "crm" : "meta";
  const ranked =
    by === "crm"
      ? videos
          .filter((v) => v.crmLeads > 0)
          .sort((a, b) => b.won - a.won || b.crmLeads - a.crmLeads || b.ticketTotal - a.ticketTotal)
      : videos.filter((v) => v.metaLeads > 0).sort((a, b) => b.metaLeads - a.metaLeads || a.spend - b.spend);

  return { by, videos: ranked.slice(0, limit), total: videos.length };
}

// ---------- Inversión en Meta y Google Ads del estudio (Inicio) ----------

export type MetaSpend = { spend: number; leads: number };

// Gasto y leads de Meta por cliente en los últimos `days` días, en una sola
// consulta para todos. Lee con la sesión del usuario (RLS): llamar solo si puede
// ver META.
export async function getMetaSpendByClient(clientIds: string[], days = 30): Promise<Map<string, MetaSpend>> {
  const totals = new Map<string, MetaSpend>();
  if (!clientIds.length) return totals;
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const supabase = await createClient();
  const rows = await readAll<{ client_id: string; spend: number | string; leads: number }>((from, to) =>
    supabase
      .from("intranet_meta_daily")
      .select("client_id, spend, leads")
      .in("client_id", clientIds)
      .gte("date", since)
      .order("date", { ascending: true })
      .range(from, to),
  );
  for (const r of rows) {
    const t = totals.get(r.client_id) ?? { spend: 0, leads: 0 };
    t.spend += Number(r.spend);
    t.leads += r.leads;
    totals.set(r.client_id, t);
  }
  return totals;
}

// Lo mismo para Google Ads: gasto por cliente en los últimos `days` días.
export async function getGadsSpendByClient(clientIds: string[], days = 30): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  if (!clientIds.length) return totals;
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const supabase = await createClient();
  const rows = await readAll<{ client_id: string; cost: number | string }>((from, to) =>
    supabase
      .from("intranet_gads_daily")
      .select("client_id, cost")
      .in("client_id", clientIds)
      .gte("date", since)
      .order("date", { ascending: true })
      .range(from, to),
  );
  for (const r of rows) totals.set(r.client_id, (totals.get(r.client_id) ?? 0) + Number(r.cost));
  return totals;
}

// ---------- Cuentas de clientes (panel de /admin) ----------

export type ClientAccount = { userId: string; clientId: string; email: string; active: boolean; createdAt: string };

// Con la sesión: la RLS de intranet_client_users solo deja ver todas a un admin.
// null si la tabla todavía no existe (falta correr la migración).
export async function getClientAccounts(): Promise<ClientAccount[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("intranet_client_users")
    .select("user_id, client_id, email, active, created_at")
    .returns<{ user_id: string; client_id: string; email: string; active: boolean; created_at: string }[]>();
  if (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  return (data ?? []).map((r) => ({
    userId: r.user_id,
    clientId: r.client_id,
    email: r.email,
    active: r.active,
    createdAt: r.created_at,
  }));
}
