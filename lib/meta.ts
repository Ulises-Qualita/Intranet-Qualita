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
