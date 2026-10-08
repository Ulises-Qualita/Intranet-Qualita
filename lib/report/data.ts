// Datos del reporte por cliente (solapa Reportes). Solo server.
//
// Junta, para un período, lo mismo que muestra el reporte de referencia
// (docs/DML_reporte_mensual_5.html) y que la intranet tiene de verdad: pauta de
// Meta y Google Ads, pipeline del CRM y Clarity. Cada parte es null si no hay
// integración o datos; el HTML omite la sección en vez de inventar valores.
import { getCrmSecrets } from "../crm-sync";
import {
  type Client,
  crmPeriod,
  getGadsCampaigns,
  getGadsDaily,
  getLeads,
  getMetaCampaigns,
  getMetaDaily,
  getSales,
  type Lead,
  type MetaAd,
  salesPeriod,
} from "../data";
import { localDate, todayISO } from "../format";
import { type Period, shiftDate } from "../period";
import { createClient } from "../supabase/server";

// Leads y Meta guardan solo esta ventana: más atrás no hay con qué comparar.
const HISTORY_DAYS = 90;
const DAY_MS = 86_400_000;

export type ReportCampaign = { name: string; spend: number; leads: number; impressions: number; clicks: number };

export type ReportCreative = {
  name: string;
  type: "video" | "image" | "other";
  // data: URI, para que el HTML no dependa de URLs de Meta que vencen.
  image: string | null;
  leads: number;
  cpl: number | null;
};

export type ReportMeta = {
  spend: number;
  leads: number;
  impressions: number;
  clicks: number;
  campaigns: ReportCampaign[];
  creativeGroups: { campaign: string; ads: ReportCreative[] }[];
};

// Google Ads. Sus "leads" son las conversiones que define la cuenta (formularios,
// llamadas…), con decimales por la atribución: se tratan como los leads de Meta,
// como en el reporte de referencia.
export type ReportGads = {
  spend: number;
  conversions: number;
  impressions: number;
  clicks: number;
  campaigns: (ReportCampaign & { channel: string | null })[];
};

export type ReportKpi = { value: string; label: string; tag?: string; up?: boolean };

export type ReportCrm = {
  total: number;
  pulse: ReportKpi[];
  weeks: { label: string; value: number }[];
  split: { firstLabel: string; first: number; lastLabel: string; last: number } | null;
  bottleneck: { stage: string; count: number; share: number }[];
  bottleneckShare: number;
  response: { stage: string; medianHours: number; within24: number; over3Days: number; sample: number } | null;
  sellers: { name: string; pct: number; won: number; leads: number }[] | null;
  sources: { name: string; leads: number }[];
  sourcesKnown: number;
  // fromSheet: las ventas salen de la planilla del cliente, por fecha de
  // confirmación; total/average en pesos y usd* en dólares, sin convertir.
  sales: {
    fromSheet: boolean;
    won: number;
    withTicket: number;
    total: number;
    average: number | null;
    usdWithTicket: number;
    usdTotal: number;
    usdAverage: number | null;
    bySource: { name: string; leads: number }[];
  } | null;
};

export type ReportClarity = {
  from: string;
  to: string;
  sessions: number;
  users: number;
  pagesPerSession: number | null;
  activeTime: number | null;
  scroll: number | null;
  rageShare: number | null;
  topPage: { url: string; sessions: number } | null;
  sources: { name: string; share: number }[];
  mobileShare: number | null;
};

export type ReportData = {
  client: { id: string; name: string };
  period: Period & { range: string; month: string };
  meta: ReportMeta | null;
  crm: ReportCrm | null;
  clarity: ReportClarity | null;
  googleAds: ReportGads | null;
  // Para decir "pendiente" (sin conectar) o "sin actividad" cuando googleAds es null.
  googleAdsConnected: boolean;
};

// ---------- Formato de fechas del encabezado ----------

// Armado a mano: Intl en es-AR da "29-ago" y "sept", y la referencia usa "29 ago" y "sep".
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const dayMonth = (iso: string, withYear = false) => {
  const [y, m, d] = iso.split("-");
  return `${d} ${MONTHS[Number(m) - 1]}${withYear ? ` ${y}` : ""}`;
};

// "04 ago – 04 sep 2026"
export const rangeLabel = (since: string, until: string) => `${dayMonth(since)} – ${dayMonth(until, true)}`;

// "Agosto 2026": el mes en el que cae la mayor parte del período.
function monthLabel(since: string, until: string) {
  const mid = new Date((Date.parse(`${since}T00:00:00Z`) + Date.parse(`${until}T00:00:00Z`)) / 2);
  const text = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" }).format(mid);
  return text.charAt(0).toUpperCase() + text.slice(1).replace(" de ", " ");
}

const shortDay = (iso: string) =>
  new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(`${iso}T00:00:00Z`))
    .replace(".", "");

const pctChange = (now: number, before: number) => Math.round(((now - before) / before) * 100);
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

// ---------- Meta ----------

// Miniatura embebida. Las URLs de Meta vencen: sin esto, el HTML descargado
// quedaría con imágenes rotas a los pocos días.
async function embed(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const type = res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
    if (!type.startsWith("image/")) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > 1_500_000) return null;
    return `data:${type};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}

// En Meta es común duplicar un anuncio en varios conjuntos con el mismo nombre:
// se suman por nombre y la miniatura sale de la copia con más gasto.
function groupAdsByName(ads: MetaAd[]) {
  const byName = new Map<string, { name: string; spend: number; leads: number; top: MetaAd }>();
  for (const ad of ads) {
    const g = byName.get(ad.name) ?? { name: ad.name, spend: 0, leads: 0, top: ad };
    g.spend += ad.spend;
    g.leads += ad.leads;
    if (ad.spend > g.top.spend) g.top = ad;
    byName.set(ad.name, g);
  }
  return [...byName.values()];
}

async function readMeta(clientId: string, period: Period): Promise<ReportMeta | null> {
  const [daily, campaigns] = await Promise.all([getMetaDaily(clientId, period), getMetaCampaigns(clientId, period)]);
  if (!daily.length && !campaigns.length) return null;

  const sum = (pick: (d: (typeof daily)[number]) => number) => daily.reduce((t, d) => t + pick(d), 0);
  const active = campaigns.filter((c) => c.spend > 0);

  // Creativos: las dos campañas con más leads y, en cada una, los 3 anuncios con más leads.
  const groups = await Promise.all(
    [...active]
      .filter((c) => c.leads > 0)
      .sort((a, b) => b.leads - a.leads)
      .slice(0, 2)
      .map(async (c) => ({
        campaign: c.name,
        ads: await Promise.all(
          groupAdsByName(c.ads)
            .filter((a) => a.leads > 0)
            .sort((a, b) => b.leads - a.leads || a.spend - b.spend)
            .slice(0, 3)
            .map(async (a) => ({
              name: a.name,
              type: a.top.creative?.type ?? "other",
              image: await embed(a.top.creative?.thumbnail ?? null),
              leads: a.leads,
              cpl: a.leads ? a.spend / a.leads : null,
            })),
        ),
      })),
  );

  return {
    spend: sum((d) => d.spend),
    leads: sum((d) => d.leads),
    impressions: sum((d) => d.impressions),
    clicks: sum((d) => d.clicks),
    campaigns: active.map((c) => ({
      name: c.name,
      spend: c.spend,
      leads: c.leads,
      impressions: c.impressions,
      clicks: c.clicks,
    })),
    creativeGroups: groups.filter((g) => g.ads.length),
  };
}

// ---------- CRM ----------

const inRange = (lead: Lead, since: string, until: string) => {
  const day = localDate(lead.created_at);
  return day >= since && day <= until;
};

// Etapa "contactado": la que se llame así o, si no, la segunda del embudo.
function contactStage(leads: Lead[], order: string[]) {
  const stages = [...new Set(leads.map((l) => l.stage).filter((s): s is string => !!s))];
  return stages.find((s) => /contact/i.test(s)) ?? order[1] ?? null;
}

function responseTime(leads: Lead[], order: string[]): ReportCrm["response"] {
  const stage = contactStage(leads, order);
  if (!stage) return null;
  const hours = leads
    .filter((l) => l.stage === stage && l.stage_changed_at)
    .map((l) => (Date.parse(l.stage_changed_at!) - Date.parse(l.created_at)) / 3_600_000)
    .filter((h) => h >= 0)
    .sort((a, b) => a - b);
  // Con muy pocos casos la mediana no dice nada.
  if (hours.length < 5) return null;
  const mid = Math.floor(hours.length / 2);
  return {
    stage,
    medianHours: hours.length % 2 ? hours[mid] : (hours[mid - 1] + hours[mid]) / 2,
    within24: hours.filter((h) => h <= 24).length,
    over3Days: hours.filter((h) => h > 72).length,
    sample: hours.length,
  };
}

async function readCrm(client: Client, period: Period): Promise<ReportCrm | null> {
  if (!client.conn.crm) return null;
  const [leads, secrets] = await Promise.all([getLeads(client.id), getCrmSecrets(client.id)]);
  const { since, until } = period;
  const current = crmPeriod(leads, period);
  const inPeriod = current.leads;
  if (!inPeriod.length) return null;

  const order = secrets?.stage_order ?? [];
  const hasStatus = leads.some((l) => l.status);
  const total = inPeriod.length;
  const days = Math.round((Date.parse(until) - Date.parse(since)) / DAY_MS) + 1;

  // ----- Pulso -----
  const pulse: ReportKpi[] = [];
  const prevUntil = shiftDate(since, 1);
  const prevSince = shiftDate(since, days);
  // Solo si el período anterior entra entero en lo que guarda el sync.
  const prevAvailable = prevSince >= shiftDate(todayISO(), HISTORY_DAYS);
  const prev = prevAvailable ? leads.filter((l) => inRange(l, prevSince, prevUntil)).length : 0;
  const captured: ReportKpi = { value: String(total), label: "Oportunidades captadas en el período" };
  if (prevAvailable && prev > 0) {
    const change = pctChange(total, prev);
    captured.tag = `${signed(change)}% vs período anterior (${prev})`;
    captured.up = change > 0;
  }
  pulse.push(captured);

  if (days >= 14) {
    const lastWeek = inPeriod.filter((l) => localDate(l.created_at) > shiftDate(until, 7)).length;
    const firstWeek = inPeriod.filter((l) => localDate(l.created_at) < shiftDate(since, -7)).length;
    const kpi: ReportKpi = { value: String(lastWeek), label: "Leads en la última semana" };
    if (firstWeek > 0) {
      const change = pctChange(lastWeek, firstWeek);
      kpi.tag = `${firstWeek} → ${lastWeek} · ${signed(change)}% vs 1ª sem.`;
      kpi.up = change > 0;
    }
    pulse.push(kpi);
  }

  if (hasStatus) {
    const open = inPeriod.filter((l) => l.status === "open").length;
    const lost = inPeriod.filter((l) => l.status === "lost").length;
    const won = inPeriod.filter((l) => l.status === "won").length;
    pulse.push({ value: String(open), label: "Abiertas en el pipeline", tag: "a seguir" });
    pulse.push({ value: String(lost), label: "Perdidas / descartadas" });
    pulse.push({
      value: String(won),
      label: "Ventas confirmadas",
      tag: `Tasa de cierre del ${Math.round((won / total) * 100)}%`,
    });
  }

  // ----- Ritmo semanal (bloques de 7 días desde el inicio del período) -----
  const weeks: ReportCrm["weeks"] = [];
  for (let start = since; start <= until; start = shiftDate(start, -7)) {
    const end = shiftDate(start, -6) < until ? shiftDate(start, -6) : until;
    weeks.push({ label: shortDay(start), value: inPeriod.filter((l) => inRange(l, start, end)).length });
  }
  let split: ReportCrm["split"] = null;
  if (weeks.length >= 2) {
    const half = Math.floor(weeks.length / 2);
    const count = (w: typeof weeks) => w.reduce((t, x) => t + x.value, 0);
    const n = half === 1 ? "Primera semana" : `Primeras ${half} semanas`;
    const m = half === 1 ? "Última semana" : `Últimas ${half} semanas`;
    split = { firstLabel: n, first: count(weeks.slice(0, half)), lastLabel: m, last: count(weeks.slice(-half)) };
  }

  // ----- Cuello de botella: las 3 etapas abiertas con más oportunidades -----
  const open = hasStatus ? inPeriod.filter((l) => l.status === "open") : inPeriod;
  const byStage = new Map<string, number>();
  for (const l of open) byStage.set(l.stage || "Sin etapa", (byStage.get(l.stage || "Sin etapa") ?? 0) + 1);
  const rank = (s: string) => (order.indexOf(s) === -1 ? order.length : order.indexOf(s));
  const bottleneck = [...byStage.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([stage, count]) => ({ stage, count, share: (count / total) * 100 }));

  // ----- Equipo -----
  const sellers = hasStatus
    ? current.sellers
        .filter((s) => s.leads > 0)
        .map((s) => ({ name: s.name, won: s.won, leads: s.leads, pct: (s.won / s.leads) * 100 }))
        .sort((a, b) => b.pct - a.pct || b.leads - a.leads)
    : null;

  // ----- Ventas y ticket -----
  const wonLeads = inPeriod.filter((l) => l.status === "won");
  const tickets = wonLeads.map((l) => l.amount).filter((a): a is number => !!a && a > 0);
  // Con planilla de ventas, la facturación oficial es la de ahí.
  const allSales = secrets?.sales_sheet ? await getSales(client.id) : null;
  const sheet = allSales && salesPeriod(allSales, leads, period);
  const sales: ReportCrm["sales"] = sheet
    ? {
        fromSheet: true,
        won: sheet.sales.length,
        withTicket: sheet.ars.count,
        total: sheet.ars.total,
        average: sheet.ars.avg,
        usdWithTicket: sheet.usd.count,
        usdTotal: sheet.usd.total,
        usdAverage: sheet.usd.avg,
        bySource: sheet.sources.map((s) => ({ name: s.name, leads: s.sales })),
      }
    : hasStatus
      ? {
          fromSheet: false,
          won: wonLeads.length,
          withTicket: tickets.length,
          total: tickets.reduce((t, a) => t + a, 0),
          average: tickets.length ? tickets.reduce((t, a) => t + a, 0) / tickets.length : null,
          usdWithTicket: 0,
          usdTotal: 0,
          usdAverage: null,
          bySource: (current.wonSources ?? []).map((s) => ({ name: s.name, leads: s.leads })),
        }
      : null;

  return {
    total,
    pulse,
    weeks,
    split,
    bottleneck,
    bottleneckShare: bottleneck.reduce((t, b) => t + b.share, 0),
    response: responseTime(inPeriod, order),
    sellers,
    sources: current.sources.map((s) => ({ name: s.name, leads: s.leads })),
    sourcesKnown: current.withSource,
    sales,
  };
}

// ---------- Clarity ----------

type ClarityRow = {
  as_of: string;
  sessions: number;
  distinct_users: number;
  pages_per_session: number | null;
  scroll_depth: number | null;
  active_time: number | null;
  rage_clicks: number;
  devices: { name: string; sessions: number }[] | null;
  sources?: { name: string; sessions: number }[] | null;
};

// Nombres de origen legibles: Clarity devuelve la URL de referencia tal cual.
function sourceLabel(raw: string) {
  const s = raw.toLowerCase();
  if (/facebook|fb\b|^fb/.test(s)) return "Facebook";
  if (/instagram|^ig$/.test(s)) return "Instagram";
  if (/google/.test(s)) return "Google";
  if (!s || s === "directo" || s === "direct" || s === "(direct)") return "Directo";
  // Referencias de otros sitios: solo el dominio (linktr.ee, no la URL entera).
  try {
    return new URL(raw).hostname.replace(/^www./, "");
  } catch {
    return raw;
  }
}

async function readClarity(client: Client, period: Period): Promise<ReportClarity | null> {
  if (!client.conn.clarity) return null;
  const supabase = await createClient();
  // "*": la columna sources llega con docs/sql/2026-09-28-reportes.sql.
  const [{ data, error }, { data: pages }] = await Promise.all([
    supabase
      .from("intranet_clarity_daily")
      .select("*")
      .eq("client_id", client.id)
      .gte("as_of", period.since)
      .lte("as_of", period.until)
      .order("as_of", { ascending: true })
      .returns<ClarityRow[]>(),
    supabase
      .from("intranet_clarity_pages")
      .select("url, sessions")
      .eq("client_id", client.id)
      .gte("as_of", period.since)
      .lte("as_of", period.until)
      .returns<{ url: string; sessions: number }[]>(),
  ]);
  if (error) throw error;
  const days = data ?? [];
  if (!days.length) return null;

  const sessions = days.reduce((t, d) => t + d.sessions, 0);
  // Promedio ponderado por sesiones: un día con 10 visitas no pesa lo mismo que uno con 1.000.
  const weighted = (pick: (d: ClarityRow) => number | null) => {
    let total = 0;
    let weight = 0;
    for (const d of days) {
      const v = pick(d);
      if (v === null || !Number.isFinite(Number(v))) continue;
      total += Number(v) * d.sessions;
      weight += d.sessions;
    }
    return weight ? total / weight : null;
  };

  const byPage = new Map<string, number>();
  for (const p of pages ?? []) byPage.set(p.url, (byPage.get(p.url) ?? 0) + p.sessions);
  const [topUrl, topSessions] = [...byPage.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];

  const bySource = new Map<string, number>();
  for (const d of days) for (const s of d.sources ?? []) {
    const name = sourceLabel(s.name);
    bySource.set(name, (bySource.get(name) ?? 0) + s.sessions);
  }
  const sourceTotal = [...bySource.values()].reduce((t, v) => t + v, 0);
  const ranked = [...bySource.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked.slice(0, 3);
  const rest = ranked.slice(3).reduce((t, [, v]) => t + v, 0);
  const sources = sourceTotal
    ? [...top, ...(rest ? [["Otros", rest] as [string, number]] : [])].map(([name, v]) => ({
        name,
        share: (v / sourceTotal) * 100,
      }))
    : [];

  let mobile = 0;
  let deviceTotal = 0;
  for (const d of days) for (const dev of d.devices ?? []) {
    deviceTotal += dev.sessions;
    if (/mobile|phone|tablet/i.test(dev.name)) mobile += dev.sessions;
  }

  return {
    from: days[0].as_of,
    to: days[days.length - 1].as_of,
    sessions,
    users: days.reduce((t, d) => t + d.distinct_users, 0),
    pagesPerSession: weighted((d) => d.pages_per_session),
    activeTime: weighted((d) => d.active_time),
    scroll: weighted((d) => d.scroll_depth),
    rageShare: sessions ? (days.reduce((t, d) => t + d.rage_clicks, 0) / sessions) * 100 : null,
    topPage: topUrl ? { url: topUrl, sessions: topSessions } : null,
    sources,
    mobileShare: deviceTotal ? (mobile / deviceTotal) * 100 : null,
  };
}

// ---------- Google Ads ----------

async function readGads(clientId: string, period: Period): Promise<ReportGads | null> {
  const [daily, campaigns] = await Promise.all([getGadsDaily(clientId, period), getGadsCampaigns(clientId, period)]);
  if (!daily.length) return null;
  const sum = (pick: (d: (typeof daily)[number]) => number) => daily.reduce((t, d) => t + pick(d), 0);
  return {
    spend: sum((d) => d.cost),
    conversions: sum((d) => d.conversions),
    impressions: sum((d) => d.impressions),
    clicks: sum((d) => d.clicks),
    campaigns: campaigns
      .filter((c) => c.cost > 0)
      .map((c) => ({
        name: c.name,
        channel: c.channel,
        spend: c.cost,
        leads: c.conversions,
        impressions: c.impressions,
        clicks: c.clicks,
      })),
  };
}

// ---------- Todo junto ----------

export async function buildReportData(client: Client, period: Period): Promise<ReportData> {
  const [meta, googleAds, crm, clarity] = await Promise.all([
    client.conn.meta ? readMeta(client.id, period) : null,
    client.conn.google_ads ? readGads(client.id, period) : null,
    readCrm(client, period),
    readClarity(client, period),
  ]);
  return {
    client: { id: client.id, name: client.name },
    period: { ...period, range: rangeLabel(period.since, period.until), month: monthLabel(period.since, period.until) },
    meta,
    crm,
    clarity,
    googleAds,
    googleAdsConnected: client.conn.google_ads,
  };
}
