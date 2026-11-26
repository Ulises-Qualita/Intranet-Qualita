// Números de un reporte, guardados aparte del HTML (intranet_client_reports.metrics).
// Sin imports de server: los usa también el formulario de revisión del navegador.
//
// Un reporte comparativo compara contra estos números de los reportes ya
// guardados (no recalcula): así funciona con meses de hace más de 90 días y
// coincide con lo que se le mostró al cliente. Los reportes generados los
// guardan solos (fromReportData); en los cargados a mano los saca Claude del
// archivo (lib/report/import.ts) y el equipo los revisa antes de guardar.
//
// Todo puede ser null: un reporte viejo puede no tener un dato. Las tasas (CPL,
// CTR, CPM) se guardan además de sus bases porque un PDF a veces trae solo la tasa.

export type Num = number | null;

export type MetricsPauta = {
  spend: Num;
  metaSpend: Num;
  gadsSpend: Num;
  leads: Num;
  metaLeads: Num;
  gadsLeads: Num;
  impressions: Num;
  clicks: Num;
  // CTR en %, CPM y CPL en pesos.
  ctr: Num;
  cpm: Num;
  cpl: Num;
  metaCpl: Num;
  gadsCpl: Num;
};

export type MetricsCampaign = { name: string; platform: "meta" | "google"; spend: Num; leads: Num; cpl: Num; ctr: Num };

export type MetricsCrm = {
  opportunities: Num;
  open: Num;
  lost: Num;
  won: Num;
  // Oportunidades de la primera y la segunda mitad del período (Aceleración).
  firstHalf: Num;
  lastHalf: Num;
  responseMedianHours: Num;
  // % contactados en 24 h.
  contacted24Pct: Num;
  over3Days: Num;
  sources: { name: string; leads: Num }[];
  sellers: { name: string; won: Num; leads: Num; billed: Num; ticketAvg: Num }[];
};

export type MetricsSales = {
  won: Num;
  withTicket: Num;
  // En pesos; usdBilled aparte, sin convertir.
  billed: Num;
  ticketAvg: Num;
  usdBilled: Num;
  bySource: { name: string; sales: Num }[];
};

export type MetricsClarity = {
  users: Num;
  sessions: Num;
  sessionsPerDay: Num;
  pagesPerSession: Num;
  // Segundos.
  activeTime: Num;
  // Porcentajes (0 a 100).
  scroll: Num;
  rageShare: Num;
  mobileShare: Num;
  sources: { name: string; share: Num }[];
};

export type ReportMetrics = {
  version: 1;
  pauta: MetricsPauta | null;
  campaigns: MetricsCampaign[];
  crm: MetricsCrm | null;
  sales: MetricsSales | null;
  clarity: MetricsClarity | null;
};

// ---------- Validación (lo que llega del navegador o de Claude) ----------

const MAX_ROWS = 40;

const num = (v: unknown): Num => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/\s/g, ""));
  return Number.isFinite(n) ? n : null;
};
const text = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 200) : "");
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const rows = <T>(v: unknown, map: (r: Record<string, unknown>) => T | null): T[] =>
  Array.isArray(v)
    ? v
        .map((r) => (obj(r) ? map(obj(r)!) : null))
        .filter((r): r is T => r !== null)
        .slice(0, MAX_ROWS)
    : [];
const pick = <K extends string>(o: Record<string, unknown>, keys: readonly K[]) =>
  Object.fromEntries(keys.map((k) => [k, num(o[k])])) as Record<K, Num>;
// Una sección sin ningún número es lo mismo que no tenerla.
const anyValue = (o: Record<string, unknown>) =>
  Object.values(o).some((v) => (Array.isArray(v) ? v.length > 0 : v !== null));

const PAUTA_KEYS = ["spend", "metaSpend", "gadsSpend", "leads", "metaLeads", "gadsLeads", "impressions", "clicks", "ctr", "cpm", "cpl", "metaCpl", "gadsCpl"] as const;
const CRM_KEYS = ["opportunities", "open", "lost", "won", "firstHalf", "lastHalf", "responseMedianHours", "contacted24Pct", "over3Days"] as const;
const SALES_KEYS = ["won", "withTicket", "billed", "ticketAvg", "usdBilled"] as const;
const CLARITY_KEYS = ["users", "sessions", "sessionsPerDay", "pagesPerSession", "activeTime", "scroll", "rageShare", "mobileShare"] as const;

export function parseMetrics(raw: unknown): ReportMetrics | null {
  const o = obj(raw);
  if (!o) return null;

  const p = obj(o.pauta);
  const pauta = p ? pick(p, PAUTA_KEYS) : null;

  const c = obj(o.crm);
  const crm: MetricsCrm | null = c
    ? {
        ...pick(c, CRM_KEYS),
        sources: rows(c.sources, (r) => (text(r.name) ? { name: text(r.name), leads: num(r.leads) } : null)),
        sellers: rows(c.sellers, (r) =>
          text(r.name)
            ? { name: text(r.name), won: num(r.won), leads: num(r.leads), billed: num(r.billed), ticketAvg: num(r.ticketAvg) }
            : null,
        ),
      }
    : null;

  const s = obj(o.sales);
  const sales: MetricsSales | null = s
    ? { ...pick(s, SALES_KEYS), bySource: rows(s.bySource, (r) => (text(r.name) ? { name: text(r.name), sales: num(r.sales) } : null)) }
    : null;

  const cl = obj(o.clarity);
  const clarity: MetricsClarity | null = cl
    ? { ...pick(cl, CLARITY_KEYS), sources: rows(cl.sources, (r) => (text(r.name) ? { name: text(r.name), share: num(r.share) } : null)) }
    : null;

  const campaigns = rows(o.campaigns, (r): MetricsCampaign | null =>
    text(r.name)
      ? {
          name: text(r.name),
          platform: r.platform === "google" ? "google" : "meta",
          spend: num(r.spend),
          leads: num(r.leads),
          cpl: num(r.cpl),
          ctr: num(r.ctr),
        }
      : null,
  );

  return {
    version: 1,
    pauta: pauta && anyValue(pauta) ? pauta : null,
    campaigns,
    crm: crm && anyValue(crm) ? crm : null,
    sales: sales && anyValue(sales) ? sales : null,
    clarity: clarity && anyValue(clarity) ? clarity : null,
  };
}

export const emptyMetrics = (): ReportMetrics => ({ version: 1, pauta: null, campaigns: [], crm: null, sales: null, clarity: null });

// ---------- Comparación ----------

// Un reporte anterior contra el que se compara: "Septiembre" / "Sep".
export type MetricsPeer = { id: string; label: string; short: string; since: string; until: string; metrics: ReportMetrics };

// Cambio porcentual; null si falta alguno de los dos o el anterior es 0.
export function change(now: Num | undefined, before: Num | undefined): Num {
  if (now === null || now === undefined || before === null || before === undefined || before === 0) return null;
  return ((now - before) / Math.abs(before)) * 100;
}

// Busca la fila del mismo nombre (sin distinguir mayúsculas ni espacios de más).
const key = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
export function findRow<T extends { name: string }>(list: T[] | undefined, name: string): T | undefined {
  const k = key(name);
  return list?.find((r) => key(r.name) === k);
}

// ---------- Desde un reporte generado ----------

// Solo los tipos que hacen falta, para no importar data.ts (que es de server).
type Source = {
  meta: { spend: number; leads: number; impressions: number; clicks: number; campaigns: { name: string; spend: number; leads: number; impressions: number; clicks: number }[] } | null;
  googleAds: { spend: number; conversions: number; impressions: number; clicks: number; campaigns: { name: string; spend: number; leads: number; impressions: number; clicks: number }[] } | null;
  crm: {
    total: number;
    split: { first: number; last: number } | null;
    response: { medianHours: number; within24: number; over3Days: number; sample: number } | null;
    sellers: { name: string; won: number; leads: number; billed: number; ticketAvg: number | null }[] | null;
    sources: { name: string; leads: number }[];
    counts: { open: number; lost: number; won: number } | null;
    sales: { won: number; withTicket: number; total: number; average: number | null; usdTotal: number; bySource: { name: string; leads: number }[] } | null;
  } | null;
  clarity: {
    from: string;
    to: string;
    sessions: number;
    users: number;
    pagesPerSession: number | null;
    activeTime: number | null;
    scroll: number | null;
    rageShare: number | null;
    mobileShare: number | null;
    sources: { name: string; share: number }[];
  } | null;
};

const div = (a: number, b: number): Num => (b ? a / b : null);

export function fromReportData(data: Source): ReportMetrics {
  const m = data.meta;
  const g = data.googleAds;
  let pauta: MetricsPauta | null = null;
  if (m || g) {
    const spend = (m?.spend ?? 0) + (g?.spend ?? 0);
    const leads = (m?.leads ?? 0) + (g?.conversions ?? 0);
    const impressions = (m?.impressions ?? 0) + (g?.impressions ?? 0);
    const clicks = (m?.clicks ?? 0) + (g?.clicks ?? 0);
    pauta = {
      spend,
      metaSpend: m ? m.spend : null,
      gadsSpend: g ? g.spend : null,
      leads,
      metaLeads: m ? m.leads : null,
      gadsLeads: g ? g.conversions : null,
      impressions,
      clicks,
      ctr: impressions ? (clicks / impressions) * 100 : null,
      cpm: impressions ? (spend / impressions) * 1000 : null,
      cpl: div(spend, leads),
      metaCpl: m ? div(m.spend, m.leads) : null,
      gadsCpl: g ? div(g.spend, g.conversions) : null,
    };
  }
  const campaign = (platform: "meta" | "google") => (c: { name: string; spend: number; leads: number; impressions: number; clicks: number }) => ({
    name: c.name,
    platform,
    spend: c.spend,
    leads: c.leads,
    cpl: div(c.spend, c.leads),
    ctr: c.impressions ? (c.clicks / c.impressions) * 100 : null,
  });

  const c = data.crm;
  const cl = data.clarity;
  const days = cl ? Math.round((Date.parse(cl.to) - Date.parse(cl.from)) / 86_400_000) + 1 : 0;
  return {
    version: 1,
    pauta,
    campaigns: [...(m?.campaigns ?? []).map(campaign("meta")), ...(g?.campaigns ?? []).map(campaign("google"))],
    crm: c && {
      opportunities: c.total,
      open: c.counts?.open ?? null,
      lost: c.counts?.lost ?? null,
      won: c.counts?.won ?? null,
      firstHalf: c.split?.first ?? null,
      lastHalf: c.split?.last ?? null,
      responseMedianHours: c.response?.medianHours ?? null,
      contacted24Pct: c.response ? (c.response.within24 / c.response.sample) * 100 : null,
      over3Days: c.response?.over3Days ?? null,
      sources: c.sources.map((s) => ({ name: s.name, leads: s.leads })),
      sellers: (c.sellers ?? []).map((s) => ({ name: s.name, won: s.won, leads: s.leads, billed: s.billed, ticketAvg: s.ticketAvg })),
    },
    sales: c?.sales
      ? {
          won: c.sales.won,
          withTicket: c.sales.withTicket,
          billed: c.sales.withTicket ? c.sales.total : null,
          ticketAvg: c.sales.average,
          usdBilled: c.sales.usdTotal || null,
          bySource: c.sales.bySource.map((s) => ({ name: s.name, sales: s.leads })),
        }
      : null,
    clarity: cl && {
      users: cl.users,
      sessions: cl.sessions,
      sessionsPerDay: days ? cl.sessions / days : null,
      pagesPerSession: cl.pagesPerSession,
      activeTime: cl.activeTime,
      scroll: cl.scroll,
      rageShare: cl.rageShare,
      mobileShare: cl.mobileShare,
      sources: cl.sources.map((s) => ({ name: s.name, share: s.share })),
    },
  };
}

// ---------- Esquema para Claude (structured outputs) ----------

// Nullable con anyOf: es la forma documentada en structured outputs.
const N = { anyOf: [{ type: "number" }, { type: "null" }] };
const NULLABLE_DATE = { anyOf: [{ type: "string", format: "date" }, { type: "null" }] };
const props = (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, N]));
const section = (keys: readonly string[], extra: Record<string, unknown> = {}) => ({
  anyOf: [
    {
      type: "object",
      additionalProperties: false,
      required: [...keys, ...Object.keys(extra)],
      properties: { ...props(keys), ...extra },
    },
    { type: "null" },
  ],
});
const list = (fields: Record<string, unknown>) => ({
  type: "array",
  items: { type: "object", additionalProperties: false, required: Object.keys(fields), properties: fields },
});

export const METRICS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["since", "until", "pauta", "campaigns", "crm", "sales", "clarity"],
  properties: {
    since: { ...NULLABLE_DATE, description: "Inicio del período del reporte." },
    until: { ...NULLABLE_DATE, description: "Fin del período del reporte." },
    pauta: section(PAUTA_KEYS),
    campaigns: list({ name: { type: "string" }, platform: { type: "string", enum: ["meta", "google"] }, spend: N, leads: N, cpl: N, ctr: N }),
    crm: section(CRM_KEYS, {
      sources: list({ name: { type: "string" }, leads: N }),
      sellers: list({ name: { type: "string" }, won: N, leads: N, billed: N, ticketAvg: N }),
    }),
    sales: section(SALES_KEYS, { bySource: list({ name: { type: "string" }, sales: N }) }),
    clarity: section(CLARITY_KEYS, { sources: list({ name: { type: "string" }, share: N }) }),
  },
};
