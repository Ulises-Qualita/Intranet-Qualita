import { cache } from "react";
import { initialsOf, type Profile } from "./auth-shared";
import type { ClientStatus } from "./client-status";
import { INTEGRATIONS, type Integration, type IntegrationState } from "./integrations";
import { LOGOS_BUCKET } from "./logos";
import { createAdminClient, createClient } from "./supabase/server";

export type { Integration } from "./integrations";

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
      conn: { meta: state.meta.connected, crm: state.crm.connected, whatsapp: state.whatsapp.connected },
    };
  });
});

export const getClients = cache(async () => (await getAllClients()).filter((c) => c.active));

export const getClient = async (slug: string) => (await getAllClients()).find((c) => c.slug === slug) ?? null;


// ---------- Tareas (intranet_tasks) ----------

export type TaskStatus = "todo" | "doing" | "done";
export type TaskPriority = "alta" | "media" | "baja";

export type Task = {
  id: string;
  client_id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_id: string | null;
  due_date: string | null;
};

export const getTasks = cache(async (): Promise<Task[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("intranet_tasks")
    .select("id, client_id, title, status, priority, assignee_id, due_date")
    .order("due_date", { ascending: true, nullsFirst: false })
    .returns<Task[]>();
  if (error) throw error;
  return data ?? [];
});

export const isOpenTask = (t: Task) => t.status !== "done";
export const isLateTask = (t: Task, today: string) => isOpenTask(t) && !!t.due_date && t.due_date < today;

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

// Último snapshot de anuncios del cliente.
export async function getMetaAds(clientId: string): Promise<MetaAd[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("intranet_meta_ads")
    .select("id, name, status, spend, leads, clicks, impressions, revenue, as_of")
    .eq("client_id", clientId)
    .order("as_of", { ascending: false })
    .order("spend", { ascending: false })
    .returns<MetaAd[]>();
  if (error) throw error;
  const latest = data?.[0]?.as_of;
  return (data ?? [])
    .filter((ad) => ad.as_of === latest)
    .map((ad) => ({ ...ad, spend: Number(ad.spend), revenue: Number(ad.revenue) }));
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
};

export async function getLeads(clientId: string): Promise<Lead[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("intranet_leads")
    .select("id, name, source, amount, stage, temperature, created_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .returns<Lead[]>();
  if (error) throw error;
  return (data ?? []).map((l) => ({ ...l, amount: l.amount === null ? null : Number(l.amount) }));
}

const STAGE_ORDER = ["Nuevos", "Contactados", "Propuesta", "Negociación", "Cerrados"];

// Embudo a partir de los leads: etapas conocidas en orden y luego cualquier otra.
export function leadFunnel(leads: Lead[]) {
  const counts = new Map<string, number>();
  for (const l of leads) {
    const stage = l.stage || "Sin etapa";
    counts.set(stage, (counts.get(stage) ?? 0) + 1);
  }
  const rank = (s: string) => {
    const i = STAGE_ORDER.indexOf(s);
    return i === -1 ? STAGE_ORDER.length : i;
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
