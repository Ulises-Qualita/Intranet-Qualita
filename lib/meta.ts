// Graph API de Meta. Solo server: usa META_APP_SECRET y tokens de usuario.
import { createHmac } from "node:crypto";
import { createAdminClient } from "./supabase/server";

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v23.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

// Con "Facebook Login for Business" los permisos se definen en una configuración
// (META_LOGIN_CONFIG_ID); con el Login clásico se piden por scope.
const SCOPES = ["ads_read", "business_management"];

export const META_OAUTH_COOKIE = "meta_oauth";

export function metaConfigured() {
  return Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET);
}

export function metaRedirectUri(origin: string) {
  return `${process.env.APP_URL || origin}/api/integraciones/meta/callback`;
}

export function metaDialogUrl(state: string, redirectUri: string) {
  const url = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
  url.searchParams.set("client_id", process.env.META_APP_ID!);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  if (process.env.META_LOGIN_CONFIG_ID) url.searchParams.set("config_id", process.env.META_LOGIN_CONFIG_ID);
  else url.searchParams.set("scope", SCOPES.join(","));
  return url.toString();
}

export class MetaError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
  }
}

// Token inválido o vencido: hay que volver a loguearse con Facebook.
export const isAuthError = (e: unknown) => e instanceof MetaError && (e.code === 190 || e.code === 102);

async function graph<T>(path: string, params: Record<string, string>, token?: string): Promise<T> {
  const url = new URL(path.startsWith("https://") ? path : `${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (token) {
    url.searchParams.set("access_token", token);
    url.searchParams.set("appsecret_proof", createHmac("sha256", process.env.META_APP_SECRET!).update(token).digest("hex"));
  }
  const res = await fetch(url, { cache: "no-store" });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.error) {
    throw new MetaError(body?.error?.message ?? `Meta respondió ${res.status}`, body?.error?.code);
  }
  return body as T;
}

// code → token corto → token de larga duración (~60 días).
export async function exchangeCode(code: string, redirectUri: string) {
  const app = { client_id: process.env.META_APP_ID!, client_secret: process.env.META_APP_SECRET! };
  const short = await graph<{ access_token: string }>("oauth/access_token", { ...app, redirect_uri: redirectUri, code });
  const long = await graph<{ access_token: string; expires_in?: number }>("oauth/access_token", {
    ...app,
    grant_type: "fb_exchange_token",
    fb_exchange_token: short.access_token,
  });
  const me = await graph<{ id: string; name: string }>("me", { fields: "id,name" }, long.access_token);
  return {
    access_token: long.access_token,
    expires_at: long.expires_in ? new Date(Date.now() + long.expires_in * 1000).toISOString() : null,
    fb_user_id: me.id,
    fb_user_name: me.name,
  };
}

// ---------- Token guardado por cliente (intranet_integration_secrets) ----------

export type MetaSecrets = {
  access_token: string;
  expires_at: string | null;
  fb_user_id: string;
  fb_user_name: string;
  account_name?: string;
  // Última sincronización de métricas (la escribe lib/meta-sync.ts).
  synced_at?: string;
  sync_error?: string | null;
};

// service_role: llamar solo después de validar el acceso del usuario.
export async function getMetaSecrets(clientId: string): Promise<MetaSecrets | null> {
  const { data } = await createAdminClient()
    .from("intranet_integration_secrets")
    .select("secrets")
    .eq("client_id", clientId)
    .eq("provider", "meta")
    .maybeSingle<{ secrets: MetaSecrets }>();
  const secrets = data?.secrets;
  if (!secrets?.access_token) return null;
  if (secrets.expires_at && secrets.expires_at < new Date().toISOString()) return null;
  return secrets;
}

export async function saveMetaSecrets(clientId: string, secrets: MetaSecrets) {
  const { error } = await createAdminClient()
    .from("intranet_integration_secrets")
    .upsert({ client_id: clientId, provider: "meta", secrets, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function deleteMetaSecrets(clientId: string) {
  await createAdminClient().from("intranet_integration_secrets").delete().eq("client_id", clientId).eq("provider", "meta");
}

// ---------- Portfolios y cuentas publicitarias ----------

export type AdAccount = { id: string; name: string; currency: string; active: boolean };
export type Portfolio = { id: string; name: string; accounts: AdAccount[] };

type RawAccount = { id: string; name?: string; currency?: string; account_status?: number; business?: { id: string; name: string } };
type Page<T> = { data: T[]; paging?: { next?: string } };

const ACCOUNT_FIELDS = "id,name,currency,account_status";

async function all<T>(path: string, params: Record<string, string>, token: string) {
  const items: T[] = [];
  let page = await graph<Page<T>>(path, { limit: "200", ...params }, token);
  items.push(...page.data);
  // Tope de páginas por las dudas; paging.next ya trae los parámetros.
  for (let i = 0; page.paging?.next && i < 20; i++) {
    page = await graph<Page<T>>(page.paging.next, {}, token);
    items.push(...page.data);
  }
  return items;
}

const toAccount = (a: RawAccount): AdAccount => ({
  id: a.id,
  name: a.name || a.id,
  currency: a.currency ?? "",
  active: a.account_status === 1,
});

// Portfolios a los que el usuario tiene acceso, con sus cuentas propias y de
// clientes, más las cuentas asignadas directamente al usuario.
export async function listPortfolios(token: string): Promise<Portfolio[]> {
  const [businesses, direct] = await Promise.all([
    all<{ id: string; name: string }>("me/businesses", { fields: "id,name" }, token),
    all<RawAccount>("me/adaccounts", { fields: `${ACCOUNT_FIELDS},business{id,name}` }, token),
  ]);

  const portfolios = new Map<string, Portfolio>();
  const add = (bizId: string, bizName: string, account: RawAccount) => {
    const p = portfolios.get(bizId) ?? { id: bizId, name: bizName, accounts: [] };
    if (!p.accounts.some((a) => a.id === account.id)) p.accounts.push(toAccount(account));
    portfolios.set(bizId, p);
  };

  await Promise.all(
    businesses.map(async (b) => {
      portfolios.set(b.id, portfolios.get(b.id) ?? { id: b.id, name: b.name, accounts: [] });
      const lists = await Promise.all(
        ["owned_ad_accounts", "client_ad_accounts"].map((edge) =>
          all<RawAccount>(`${b.id}/${edge}`, { fields: ACCOUNT_FIELDS }, token).catch(() => []),
        ),
      );
      lists.flat().forEach((a) => add(b.id, b.name, a));
    }),
  );
  direct.forEach((a) => (a.business ? add(a.business.id, a.business.name, a) : add("personal", "Sin portfolio", a)));

  return [...portfolios.values()]
    .map((p) => ({ ...p, accounts: p.accounts.sort((a, b) => a.name.localeCompare(b.name, "es")) }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export async function getAdAccount(token: string, accountId: string) {
  return toAccount(await graph<RawAccount>(accountId, { fields: ACCOUNT_FIELDS }, token));
}

// ---------- Insights (métricas de la cuenta y de cada anuncio) ----------

export type DailyInsight = {
  date: string;
  reach: number;
  impressions: number;
  clicks: number;
  spend: number;
  leads: number;
  conversions: number;
  revenue: number;
};

export type AdInsight = DailyInsight & { adId: string; name: string; campaignId: string | null; campaignName: string | null };

type Action = { action_type: string; value?: string };

type RawInsight = {
  date_start: string;
  impressions?: string;
  clicks?: string;
  reach?: string;
  spend?: string;
  actions?: Action[];
  action_values?: Action[];
  ad_id?: string;
  ad_name?: string;
  campaign_id?: string;
  campaign_name?: string;
};

const INSIGHT_FIELDS = "impressions,clicks,reach,spend,actions,action_values";

// Meta reporta el mismo hecho con varios action_type solapados (p. ej. "lead" y
// "onsite_conversion.lead_grouped"): sumarlos duplicaría. Se toma el mayor.
const LEAD_TYPES = ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead", "leadgen_grouped"];
const PURCHASE_TYPES = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"];

const pick = (actions: Action[] | undefined, types: string[]) =>
  Math.max(0, ...types.map((t) => Number(actions?.find((a) => a.action_type === t)?.value ?? 0)));

const toDaily = (r: RawInsight): DailyInsight => ({
  date: r.date_start,
  reach: Number(r.reach ?? 0),
  impressions: Number(r.impressions ?? 0),
  clicks: Number(r.clicks ?? 0),
  spend: Number(r.spend ?? 0),
  leads: pick(r.actions, LEAD_TYPES),
  conversions: pick(r.actions, PURCHASE_TYPES),
  revenue: pick(r.action_values, PURCHASE_TYPES),
});

const timeRange = (since: string, until: string) => JSON.stringify({ since, until });

// Una fila por día de la cuenta publicitaria.
export async function getAccountInsights(token: string, accountId: string, since: string, until: string) {
  const rows = await all<RawInsight>(
    `${accountId}/insights`,
    { level: "account", time_increment: "1", fields: INSIGHT_FIELDS, time_range: timeRange(since, until) },
    token,
  );
  return rows.map(toDaily);
}

// Una fila por anuncio y por día: permite sumar después el período que se mire.
export async function getAdInsights(token: string, accountId: string, since: string, until: string) {
  const rows = await all<RawInsight>(
    `${accountId}/insights`,
    {
      level: "ad",
      time_increment: "1",
      fields: `ad_id,ad_name,campaign_id,campaign_name,${INSIGHT_FIELDS}`,
      time_range: timeRange(since, until),
    },
    token,
  );
  return rows
    .filter((r) => r.ad_id)
    .map((r): AdInsight => ({
      ...toDaily(r),
      adId: r.ad_id!,
      name: r.ad_name || r.ad_id!,
      campaignId: r.campaign_id ?? null,
      campaignName: r.campaign_name ?? null,
    }));
}

// Estado actual de cada anuncio (insights no lo trae).
export async function getAdStatuses(token: string, accountId: string) {
  const rows = await all<{ id: string; effective_status?: string }>(
    `${accountId}/ads`,
    { fields: "id,effective_status" },
    token,
  );
  return new Map(rows.map((a) => [a.id, a.effective_status === "ACTIVE" ? "activo" : "pausado"]));
}

// ---------- Creativos (miniatura y tipo) y vista previa ----------

export type CreativeType = "video" | "image" | "other";
export type AdCreative = { adId: string; type: CreativeType; thumbnail: string | null };

type RawCreative = {
  object_type?: string;
  video_id?: string;
  image_url?: string;
  thumbnail_url?: string;
  object_story_spec?: { video_data?: { video_id?: string } };
  asset_feed_spec?: { videos?: { video_id?: string }[] };
};

const CREATIVE_FIELDS =
  "object_type,video_id,image_url,thumbnail_url,object_story_spec{video_data{video_id}},asset_feed_spec{videos{video_id}}";

// Un video puede venir en tres lugares según cómo se armó el anuncio: creativo
// simple, publicación de la página o creativo dinámico (asset_feed_spec).
function creativeType(c: RawCreative): CreativeType {
  if (c.video_id || c.object_story_spec?.video_data?.video_id || c.asset_feed_spec?.videos?.length) return "video";
  if (c.object_type === "VIDEO") return "video";
  if (c.image_url || c.object_type === "PHOTO" || c.object_type === "SHARE") return "image";
  return "other";
}

// Miniatura y tipo de cada anuncio de la cuenta. thumbnail_url sale por defecto
// en 64×64; se pide más grande para la card del CRM, y si Meta rechaza el
// modificador se reintenta sin él (miniatura chica, pero miniatura).
export async function getAdCreatives(token: string, accountId: string): Promise<AdCreative[]> {
  const read = (creative: string) =>
    // Página más chica que la de siempre: con el creativo expandido, 200 anuncios
    // por página puede superar el límite de datos de Meta.
    all<{ id: string; creative?: RawCreative }>(
      `${accountId}/ads`,
      { fields: `id,${creative}{${CREATIVE_FIELDS}}`, limit: "100" },
      token,
    );
  const rows = await read("creative.thumbnail_width(480).thumbnail_height(480)").catch(() => read("creative"));
  return rows
    .filter((a) => a.creative)
    .map((a) => {
      const type = creativeType(a.creative!);
      // Para imágenes, image_url es el archivo original; la miniatura sale recortada.
      const thumbnail = (type === "image" ? a.creative!.image_url : null) ?? a.creative!.thumbnail_url ?? null;
      return { adId: a.id, type, thumbnail };
    });
}

// Formatos de vista previa a probar en orden: un anuncio que solo sale en
// Instagram no tiene vista de feed de Facebook, y al revés.
const PREVIEW_FORMATS = ["MOBILE_FEED_STANDARD", "INSTAGRAM_STANDARD", "INSTAGRAM_REELS", "INSTAGRAM_STORY"];

export type AdPreview = { src: string; width: number; height: number };

// Vista previa oficial del anuncio (reproduce los videos). Meta devuelve un
// <iframe> con una URL firmada que vence en ~24 h, así que se pide al abrirla y
// no se guarda. Solo se acepta un src de facebook.com: es HTML de un tercero y
// no se inyecta tal cual en la página.
export async function getAdPreview(token: string, adId: string): Promise<AdPreview | null> {
  for (const format of PREVIEW_FORMATS) {
    const res = await graph<{ data: { body?: string }[] }>(`${adId}/previews`, { ad_format: format }, token).catch((e) => {
      if (isAuthError(e)) throw e;
      return null;
    });
    const body = res?.data?.[0]?.body;
    const src = body?.match(/src="([^"]+)"/)?.[1]?.replaceAll("&amp;", "&");
    if (!src) continue;
    try {
      if (!/(^|\.)facebook\.com$/.test(new URL(src).hostname)) continue;
    } catch {
      continue;
    }
    const size = (attr: string, fallback: number) => Number(body!.match(new RegExp(`${attr}="(\d+)"`))?.[1]) || fallback;
    return { src, width: size("width", 400), height: size("height", 700) };
  }
  return null;
}
