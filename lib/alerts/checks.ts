// Qué vigila cada tipo de alerta. Solo server: lee con service_role (corre en el
// cron, sin sesión). Cada chequeo devuelve, por cosa vigilada, si está mal, bien
// o no se puede saber; lib/alerts/run.ts decide qué se manda.
import { CONNECT_PAGES, integrationMeta } from "../integrations";
import { localDate, money, todayISO } from "../format";
import { shiftDate } from "../period";
import { createAdminClient } from "../supabase/server";
import { tgEscape } from "../telegram";
import { getUsdRate } from "../usd-rate";
import type { AlertType } from "./types";

export type Check = {
  // Qué se vigila: una fila de intranet_alerts por key.
  key: string;
  type: AlertType;
  clientId: string | null;
  // "unknown": no hay datos para decidir; la alerta queda como estaba.
  state: "bad" | "ok" | "unknown";
  title: string;
  // Texto (HTML de Telegram) cuando está mal.
  body?: string;
  // Texto al arreglarse; sin él, se cierra sin avisar.
  resolved?: string;
  // Se vuelve a mandar una vez por día mientras siga mal (si no, una sola vez).
  repeatDaily?: boolean;
  // Alertas con el mismo group van juntas en un mensaje (los creativos de un cliente).
  group?: string;
};

export type AlertClient = { id: string; name: string; slug: string };

const APP_URL = () => (process.env.APP_URL ?? "").replace(/\/$/, "");
const link = (client: AlertClient, path: string, label: string) =>
  APP_URL() ? `\n<a href="${APP_URL()}/clientes/${client.slug}${path ? `/${path}` : ""}">${label}</a>` : "";
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const name = (c: AlertClient) => `<b>${tgEscape(c.name)}</b>`;

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

type SecretRow = { client_id: string; provider: string; secrets: Record<string, unknown> | null };
type IntegrationRow = { client_id: string; provider: string };

// Lo que comparten los chequeos: clientes, integraciones conectadas y secrets.
export async function loadContext() {
  const db = createAdminClient();
  const [clients, integrations, secrets] = await Promise.all([
    db.from("intranet_clients").select("*").returns<(AlertClient & { internal?: boolean })[]>(),
    db.from("intranet_client_integrations").select("client_id, provider").eq("connected", true).returns<IntegrationRow[]>(),
    db.from("intranet_integration_secrets").select("client_id, provider, secrets").returns<SecretRow[]>(),
  ]);
  if (clients.error) throw clients.error;
  if (integrations.error) throw integrations.error;
  if (secrets.error) throw secrets.error;
  // El panel interno de Qualita no tiene pauta ni ventas.
  const byId = new Map((clients.data ?? []).filter((c) => !c.internal).map((c) => [c.id, c]));
  const connected = new Set((integrations.data ?? []).map((i) => `${i.client_id}:${i.provider}`));
  const secretOf = new Map((secrets.data ?? []).map((s) => [`${s.client_id}:${s.provider}`, s.secrets ?? {}]));
  return { db, clients: byId, connected, secretOf };
}
type Context = Awaited<ReturnType<typeof loadContext>>;

// Conectada y sincronizando bien hoy: sus datos de ayer sirven para decidir.
const healthy = (ctx: Context, clientId: string, provider: string) => {
  if (!ctx.connected.has(`${clientId}:${provider}`)) return false;
  const s = ctx.secretOf.get(`${clientId}:${provider}`);
  return !!s && !s.sync_error && typeof s.synced_at === "string" && localDate(s.synced_at) === todayISO();
};

// ---------- Integraciones ----------

const WATCHED = ["meta", "google_ads", "crm", "clarity"] as const;
const TOKEN_DAYS = 5;

export function integrationChecks(ctx: Context): Check[] {
  const checks: Check[] = [];
  for (const client of ctx.clients.values()) {
    for (const provider of WATCHED) {
      if (!ctx.connected.has(`${client.id}:${provider}`)) continue;
      const s = ctx.secretOf.get(`${client.id}:${provider}`);
      if (!s || s.demo) continue;
      const label = integrationMeta(provider).title;
      const error = typeof s.sync_error === "string" && s.sync_error ? s.sync_error : null;
      checks.push({
        key: `integration:${client.id}:${provider}`,
        type: "integration",
        clientId: client.id,
        state: error ? "bad" : s.synced_at ? "ok" : "unknown",
        title: "Integración caída",
        body: `${tgEscape(label)} de ${name(client)} no sincroniza:\n<i>${tgEscape(error ?? "").slice(0, 300)}</i>${link(client, CONNECT_PAGES[provider].path, "Revisar la conexión")}`,
        resolved: `✅ ${tgEscape(label)} de ${name(client)} volvió a sincronizar.`,
      });
      // El token de Meta dura ~60 días: avisar antes de que se corte.
      if (provider === "meta" && typeof s.expires_at === "string") {
        const days = (Date.parse(s.expires_at) - Date.now()) / 86_400_000;
        checks.push({
          key: `integration:${client.id}:meta-token`,
          type: "integration",
          clientId: client.id,
          state: days < TOKEN_DAYS ? "bad" : "ok",
          title: "Acceso a Meta por vencer",
          body: `El acceso a Meta de ${name(client)} ${days < 0 ? "venció" : "vence"} el ${dm(localDate(s.expires_at))}: hay que volver a iniciar sesión con Facebook.${link(client, CONNECT_PAGES.meta.path, "Reconectar Meta")}`,
          resolved: `✅ El acceso a Meta de ${name(client)} se renovó.`,
        });
      }
    }
  }
  return checks;
}

// ---------- Cuentas sin gasto ----------

// Venía gastando: al menos 3 de los 7 días anteriores a ayer.
const ACTIVE_DAYS = 3;

export async function spendChecks(ctx: Context): Promise<Check[]> {
  const yesterday = shiftDate(todayISO(), 1);
  const from = shiftDate(yesterday, 7);
  const platforms = [
    { provider: "meta", label: "Meta Ads", table: "intranet_meta_daily", column: "spend", tab: "meta" },
    { provider: "google_ads", label: "Google Ads", table: "intranet_gads_daily", column: "cost", tab: "gads" },
  ] as const;
  const checks: Check[] = [];
  for (const p of platforms) {
    const ids = [...ctx.clients.keys()].filter((id) => healthy(ctx, id, p.provider));
    if (!ids.length) continue;
    const { data, error } = await ctx.db
      .from(p.table)
      .select(`client_id, date, ${p.column}`)
      .in("client_id", ids)
      .gte("date", from)
      .lte("date", yesterday)
      .returns<Record<string, string | number>[]>();
    if (error) throw error;
    for (const id of ids) {
      const client = ctx.clients.get(id)!;
      const byDay = new Map<string, number>();
      for (const r of data ?? []) {
        if (r.client_id !== id) continue;
        byDay.set(String(r.date), (byDay.get(String(r.date)) ?? 0) + Number(r[p.column] ?? 0));
      }
      const spentYesterday = byDay.get(yesterday) ?? 0;
      const before = [...byDay.entries()].filter(([d]) => d < yesterday).map(([, v]) => v);
      const activeDays = before.filter((v) => v > 0).length;
      const avg = before.reduce((t, v) => t + v, 0) / 7;
      checks.push({
        key: `spend:${id}:${p.provider}`,
        type: "spend",
        clientId: id,
        state: spentYesterday > 0 ? "ok" : activeDays >= ACTIVE_DAYS ? "bad" : "unknown",
        title: "Cuenta sin gasto",
        body: `${p.label} de ${name(client)} no gastó nada ayer (${dm(yesterday)}). Venía gastando ${money(avg)} por día: revisá el presupuesto y el saldo de la cuenta.${link(client, p.tab, `Ver ${p.label}`)}`,
        resolved: `✅ ${p.label} de ${name(client)} volvió a gastar (${money(spentYesterday)} ayer).`,
      });
    }
  }
  return checks;
}

// ---------- Baja de facturación ----------

const BILLING_DROP = 20;
const BILLING_FROM_DAY = 8;

export async function billingChecks(ctx: Context): Promise<Check[]> {
  const today = todayISO();
  const yesterday = shiftDate(today, 1);
  const day = Number(yesterday.slice(8, 10));
  if (day < BILLING_FROM_DAY) return [];

  // Del 1 a ayer, contra los mismos días del mes anterior (sin pasarse de su último día).
  const [y, m] = yesterday.split("-").map(Number);
  const curFrom = `${yesterday.slice(0, 8)}01`;
  const prevFirst = new Date(Date.UTC(y, m - 2, 1));
  const prevLast = new Date(Date.UTC(y, m - 1, 0)).getUTCDate();
  const prevFrom = prevFirst.toISOString().slice(0, 10);
  const prevTo = `${prevFrom.slice(0, 8)}${String(Math.min(day, prevLast)).padStart(2, "0")}`;
  const inCur = (d: string) => d >= curFrom && d <= yesterday;
  const inPrev = (d: string) => d >= prevFrom && d <= prevTo;

  let rate: number | null | undefined;
  const usdRate = async () => {
    if (rate === undefined) rate = (await getUsdRate(today))?.rate ?? null;
    return rate;
  };

  const checks: Check[] = [];
  for (const client of ctx.clients.values()) {
    if (!ctx.connected.has(`${client.id}:crm`)) continue;
    const s = ctx.secretOf.get(`${client.id}:crm`);
    if (!s || s.demo) continue;
    // Ventas fuera del CRM y sin planilla: no hay facturación que comparar.
    if (s.sales_off && !s.sales_sheet) continue;

    const totals = { cur: { ars: 0, usd: 0 }, prev: { ars: 0, usd: 0 } };
    const add = (d: string, ars: unknown, usd: unknown) => {
      const bucket = inCur(d) ? totals.cur : inPrev(d) ? totals.prev : null;
      if (!bucket) return;
      bucket.ars += Number(ars ?? 0) || 0;
      bucket.usd += Number(usd ?? 0) || 0;
    };
    if (s.sales_sheet) {
      // Con planilla, la facturación sale de ahí, por fecha de confirmación.
      const { data, error } = await ctx.db
        .from("intranet_crm_sales")
        .select("confirmed_on, amount_ars, amount_usd")
        .eq("client_id", client.id)
        .gte("confirmed_on", prevFrom)
        .lte("confirmed_on", yesterday)
        .returns<{ confirmed_on: string; amount_ars: number | null; amount_usd: number | null }[]>();
      if (error) continue;
      for (const r of data ?? []) add(r.confirmed_on, r.amount_ars, r.amount_usd);
    } else {
      // Ventas del CRM por fecha de venta (won_at; si falta, la creación), como Vista general.
      const { data, error } = await ctx.db
        .from("intranet_leads")
        .select("won_at, created_at, amount, amount_usd, excluded")
        .eq("client_id", client.id)
        .eq("status", "won")
        .returns<{ won_at: string | null; created_at: string; amount: number | null; amount_usd: number | null; excluded: string | null }[]>();
      if (error) continue;
      for (const r of data ?? []) if (!r.excluded) add(localDate(r.won_at ?? r.created_at), r.amount, r.amount_usd);
    }

    const usd = totals.cur.usd || totals.prev.usd ? await usdRate() : 0;
    // Con dólares y sin cotización no se puede comparar bien.
    if (usd === null) continue;
    const cur = totals.cur.ars + totals.cur.usd * usd;
    const prev = totals.prev.ars + totals.prev.usd * usd;
    if (prev <= 0) {
      checks.push({ key: `billing:${client.id}`, type: "billing", clientId: client.id, state: "unknown", title: "" });
      continue;
    }
    const change = ((cur - prev) / prev) * 100;
    const curMonth = MONTHS[m - 1];
    const prevMonth = MONTHS[prevFirst.getUTCMonth()];
    checks.push({
      key: `billing:${client.id}`,
      type: "billing",
      clientId: client.id,
      state: change <= -BILLING_DROP ? "bad" : "ok",
      title: "Baja de facturación",
      body:
        `${name(client)} facturó ${money(cur)} en ${curMonth} hasta el ${day}: <b>${Math.round(-change)}% menos</b> que ${prevMonth} a la misma altura (${money(prev)}).` +
        (usd ? " Los dólares van pasados a pesos al oficial de hoy." : "") +
        link(client, "", "Ver Vista general"),
      repeatDaily: true,
    });
  }
  return checks;
}

// ---------- Creativos ----------

const CREATIVE_DAYS = 7;
const CPL_FACTOR = 2;
// La campaña necesita algunos leads para que su CPL sea una referencia.
const MIN_CAMPAIGN_LEADS = 3;

type AdRow = {
  client_id: string;
  ad_external_id: string;
  name: string;
  status: string | null;
  spend: number;
  leads: number;
  as_of: string;
  campaign_external_id: string | null;
  campaign_name: string | null;
};

export async function creativeChecks(ctx: Context): Promise<Check[]> {
  const yesterday = shiftDate(todayISO(), 1);
  const from = shiftDate(yesterday, CREATIVE_DAYS - 1);
  const recent = shiftDate(yesterday, 1);
  const ids = [...ctx.clients.keys()].filter((id) => healthy(ctx, id, "meta"));
  if (!ids.length) return [];

  const rows: AdRow[] = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await ctx.db
      .from("intranet_meta_ads")
      .select("client_id, ad_external_id, name, status, spend, leads, as_of, campaign_external_id, campaign_name")
      .in("client_id", ids)
      .gte("as_of", from)
      .lte("as_of", yesterday)
      .order("id")
      .range(start, start + 999)
      .returns<AdRow[]>();
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) break;
  }

  type Ad = { id: string; name: string; campaign: string; campaignName: string; spend: number; leads: number; status: string | null; last: string; recent: boolean };
  const checks: Check[] = [];
  for (const id of ids) {
    const client = ctx.clients.get(id)!;
    const ads = new Map<string, Ad>();
    for (const r of rows) {
      if (r.client_id !== id) continue;
      const ad = ads.get(r.ad_external_id) ?? {
        id: r.ad_external_id,
        name: r.name,
        campaign: r.campaign_external_id ?? "",
        campaignName: r.campaign_name ?? "",
        spend: 0,
        leads: 0,
        status: r.status,
        last: r.as_of,
        recent: false,
      };
      ad.spend += Number(r.spend) || 0;
      ad.leads += Number(r.leads) || 0;
      if (r.as_of >= ad.last) {
        ad.last = r.as_of;
        ad.status = r.status;
      }
      if (r.as_of >= recent && Number(r.spend) > 0) ad.recent = true;
      ads.set(r.ad_external_id, ad);
    }
    const campaigns = new Map<string, { spend: number; leads: number; ads: number }>();
    for (const ad of ads.values()) {
      const c = campaigns.get(ad.campaign) ?? { spend: 0, leads: 0, ads: 0 };
      c.spend += ad.spend;
      c.leads += ad.leads;
      if (ad.spend > 0) c.ads += 1;
      campaigns.set(ad.campaign, c);
    }

    for (const ad of ads.values()) {
      const c = campaigns.get(ad.campaign)!;
      const base = { key: `creative:${id}:${ad.id}`, type: "creative" as const, clientId: id, title: "Creativos con mal rendimiento", group: `creative:${id}` };
      // Pausado o sin gasto en los últimos dos días: deja de vigilarse (se cierra sin avisar).
      if (ad.status !== "activo" || !ad.recent) {
        checks.push({ ...base, state: "ok" });
        continue;
      }
      // Sin una campaña de referencia (de tráfico, con pocos leads o un solo anuncio) no se juzga.
      if (c.leads < MIN_CAMPAIGN_LEADS || c.ads < 2) {
        checks.push({ ...base, state: "unknown" });
        continue;
      }
      const campCpl = c.spend / c.leads;
      const adCpl = ad.leads ? ad.spend / ad.leads : null;
      const bad = adCpl !== null ? adCpl >= CPL_FACTOR * campCpl && ad.spend >= campCpl : ad.spend >= CPL_FACTOR * campCpl;
      const detail =
        adCpl !== null
          ? `${money(ad.spend)}, ${ad.leads} ${ad.leads === 1 ? "lead" : "leads"}, CPL ${money(adCpl)} contra ${money(campCpl)} de la campaña (${(adCpl / campCpl).toFixed(1).replace(".", ",")}×)`
          : `${money(ad.spend)} gastados sin ningún lead (CPL de la campaña: ${money(campCpl)})`;
      checks.push({
        ...base,
        state: bad ? "bad" : "ok",
        body: `• <b>${tgEscape(ad.name)}</b> (${tgEscape(ad.campaignName)}): ${detail}.`,
      });
    }
    // El encabezado y el link van una vez por cliente (lib/alerts/run.ts arma el grupo).
    for (const check of checks) {
      if (check.group === `creative:${id}` && check.state === "bad") {
        check.title = `Creativos con mal rendimiento · ${client.name}`;
      }
    }
  }
  return checks;
}

export const creativeFooter = (client: AlertClient) =>
  `Últimos ${CREATIVE_DAYS} días hasta ayer.${link(client, "meta", "Ver META")}`;
