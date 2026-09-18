import { cache } from "react";
import { initialsOf, type Profile } from "./auth-shared";
import type { ClientStatus } from "./client-status";
import { INTEGRATIONS, type Integration, type IntegrationState } from "./integrations";
import { LOGOS_BUCKET } from "./logos";
import { getTickets, notionConfigured, notionErrorMessage } from "./notion";
import { EMPTY_NOTION_CONFIG, isNotionConfigured, normalizeId, type NotionConfig } from "./notion-map";
import { createAdminClient, createClient } from "./supabase/server";
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
};

// Logo de cada cliente: un objeto por cliente en el bucket, con nombre = client id.
// El bucket es público para leer; listar requiere service_role.
const getLogoUrls = cache(async (): Promise<Map<string, string>> => {
  const storage = createAdminClient().storage.from(LOGOS_BUCKET);
  const { data } = await storage.list("", { limit: 1000 });
  return new Map(
    (data ?? [])
      .filter((f) => f.id)
      .map((f) => [f.name, `${storage.getPublicUrl(f.name).data.publicUrl}?v=${Date.parse(f.updated_at ?? "") || 0}`]),
  );
});

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
  const [{ data, error }, logos] = await Promise.all([
    supabase
      .from("intranet_clients")
      .select(
        "id, slug, name, sector, website, active, status, intranet_client_integrations(provider, connected, account_ref, connected_at), intranet_client_assignments(user_id)",
      )
      .order("name", { ascending: true })
      .returns<ClientRow[]>(),
    getLogoUrls(),
  ]);
  if (error) throw error;

  return (data ?? []).map(({ intranet_client_integrations: integrations, intranet_client_assignments: assignments, ...row }) => {
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

export async function getMetaDaily(clientId: string, days = 30): Promise<MetaDaily[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("intranet_meta_daily")
    .select("date, reach, impressions, clicks, spend, leads, conversions, revenue, followers, engagements")
    .eq("client_id", clientId)
    .gte("date", since)
    .order("date", { ascending: true })
    .returns<MetaDaily[]>();
  if (error) throw error;
  return (data ?? []).map((d) => ({ ...d, spend: Number(d.spend), revenue: Number(d.revenue) }));
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
};

export type MetaCampaign = MetaAd & { ads: MetaAd[] };


type MetaAdRow = MetaAd & {
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
export async function getMetaCampaigns(clientId: string, days = 30): Promise<MetaCampaign[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const supabase = await createClient();
  const rows = await readAll<MetaAdRow>((from, to) =>
    supabase
      .from("intranet_meta_ads")
      .select(
        "id, ad_external_id, name, status, spend, leads, clicks, impressions, revenue, as_of, campaign_external_id, campaign_name",
      )
      .eq("client_id", clientId)
      .gte("as_of", since)
      .order("as_of", { ascending: false })
      .range(from, to)
      .returns<MetaAdRow[]>(),
  );

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
        ads: [],
      };
      campaigns.set(campaignId, campaign);
    }

    let ad = ads.get(adId);
    if (!ad) {
      ad = { id: adId, name: row.name, status: row.status, spend: 0, leads: 0, clicks: 0, impressions: 0, revenue: 0, as_of: row.as_of };
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
};

const LEAD_COLUMNS = "id, name, source, amount, stage, temperature, created_at";
// Columnas agregadas después (ver docs/sql/): mientras la base no las tenga, la
// vista se muestra igual sin esos datos en vez de romper.
const LEAD_EXTRA_COLUMNS = ["status", "owner", "ad"];

export async function getLeads(clientId: string): Promise<Lead[]> {
  const supabase = await createClient();
  const read = (columns: string) =>
    readAll<Lead>((from, to) =>
      supabase
        .from("intranet_leads")
        .select(columns)
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .range(from, to)
        .returns<Lead[]>(),
    );

  const data = await read([LEAD_COLUMNS, ...LEAD_EXTRA_COLUMNS].join(", ")).catch((e) => {
    // Alguna columna opcional todavía no existe en la base: se lee sin ellas.
    if ((e as { code?: string })?.code !== "42703") throw e;
    return read(LEAD_COLUMNS);
  });
  return data.map((l) => ({
    ...l,
    status: l.status ?? null,
    owner: l.owner ?? null,
    ad: l.ad ?? null,
    amount: l.amount === null ? null : Number(l.amount),
  }));
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

export type AdStats = { name: string; leads: number; won: number; tickets: number; ticketTotal: number };

// Rendimiento por anuncio. Solo entran las oportunidades que traen el anuncio
// cargado: el resto no se puede atribuir y contarlas como "sin anuncio" mezclaría
// las que vinieron por otro canal con las que nadie completó.
function groupAds(leads: Lead[]): AdStats[] {
  const byAd = new Map<string, AdStats>();

  for (const lead of leads) {
    const name = lead.ad?.trim();
    if (!name) continue;
    const ad = byAd.get(name) ?? { name, leads: 0, won: 0, tickets: 0, ticketTotal: 0 };
    ad.leads += 1;
    if (lead.status === "won") ad.won += 1;
    if (lead.amount && lead.amount > 0) {
      ad.tickets += 1;
      ad.ticketTotal += lead.amount;
    }
    byAd.set(name, ad);
  }

  return [...byAd.values()].sort((a, b) => b.leads - a.leads || b.ticketTotal - a.ticketTotal);
}

export type SourceStats = { name: string; leads: number; share: number };

// De dónde vienen las oportunidades. "Sin origen" va último y aparte: en el CRM
// el campo es opcional y suele quedar vacío, así que conviene verlo separado.
function groupSources(leads: Lead[]): SourceStats[] {
  const bySource = new Map<string, number>();
  for (const lead of leads) {
    const name = lead.source?.trim() || "Sin origen";
    bySource.set(name, (bySource.get(name) ?? 0) + 1);
  }

  const total = leads.length || 1;
  return [...bySource.entries()]
    .map(([name, count]) => ({ name, leads: count, share: (count * 100) / total }))
    .sort((a, b) => {
      if (a.name === "Sin origen") return 1;
      if (b.name === "Sin origen") return -1;
      return b.leads - a.leads;
    });
}

// Corte por período para la vista de CRM: qué leads entran y qué se calcula
// sobre ellos, siempre por fecha de creación.
export function crmPeriod(leads: Lead[], days: number) {
  const since = Date.now() - days * 86_400_000;
  const inPeriod = leads.filter((l) => Date.parse(l.created_at) >= since);
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
    ads: groupAds(inPeriod),
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

export type TeamMember = Profile & { name: string; avatarUrl: string | null; invited: boolean };

// Miembros del equipo con su foto de Google. Usa service_role (RLS solo deja ver
// el propio perfil a los members): llamar únicamente después de validar canAccess.
export const getTeam = cache(async (): Promise<TeamMember[]> => {
  const admin = createAdminClient();
  const [{ data: profiles, error }, { data: authUsers }] = await Promise.all([
    admin
      .from("intranet_profiles")
      .select("id, email, full_name, role, areas, active")
      .order("email", { ascending: true })
      .returns<Profile[]>(),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ]);
  if (error) throw error;

  const users = new Map((authUsers?.users ?? []).map((u) => [u.id, u]));

  return (profiles ?? []).map((p) => {
    const user = users.get(p.id);
    const meta = user?.user_metadata ?? {};
    return {
      ...p,
      name: meta.full_name || meta.name || p.full_name || p.email?.split("@")[0] || "Sin nombre",
      avatarUrl: meta.avatar_url || meta.picture || null,
      // Alta hecha desde Administración que todavía no ingresó con Google.
      invited: !user?.last_sign_in_at,
    };
  });
});
