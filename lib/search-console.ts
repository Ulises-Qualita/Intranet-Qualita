// Google Search Console (solapa SEO, solo equipo). Solo server.
//
// Las propiedades de los clientes están en la cuenta de Search Console del estudio.
// Se leen con la misma cuenta de servicio de Calendar, Drive y Google Ads
// (lib/google.ts), con el scope de solo lectura:
// - Con GOOGLE_SEARCH_CONSOLE_USER, la cuenta de servicio actúa como ese usuario
//   (delegación de dominio: el scope webmasters.readonly tiene que estar en la
//   entrada de admin.google.com, junto a los demás).
// - Sin esa variable, actúa como sí misma: hay que sumar el email de la cuenta de
//   servicio como usuario en cada propiedad de Search Console.
// La API "Google Search Console API" tiene que estar habilitada en el proyecto de
// Cloud de las credenciales.
//
// Cada cliente se vincula a una propiedad: provider 'search_console',
// account_ref = siteUrl tal cual lo da la API ("sc-domain:ejemplo.com" para una
// propiedad de dominio, "https://www.ejemplo.com/" para un prefijo de URL).
//
// Los datos de Search Console se cierran con 2 o 3 días de demora: se pide
// dataState "all" (incluye los días frescos, como la pantalla de Search Console)
// y el período se corta en el último día con datos, para comparar contra la misma
// cantidad de días del período anterior. Todo se guarda 3 horas (GSC_TAG, que
// descarta el botón Actualizar).
import { unstable_cache } from "next/cache";
import { googleAccessToken, GoogleAuthError, googleConfigured } from "./google";
import { type Period, previousPeriod } from "./period";

const API = "https://searchconsole.googleapis.com/webmasters/v3";
const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
export const GSC_TAG = "search-console";
const TTL = 3 * 3600;
const QUERY_ROWS = 1000;
const PAGE_ROWS = 500;

export const searchConsoleConfigured = () => googleConfigured();

export class SearchConsoleError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason: string | null = null,
  ) {
    super(message);
  }
}

// Mensaje para la pantalla, sin detalles técnicos de más.
export function searchConsoleErrorMessage(e: unknown): string {
  if (e instanceof GoogleAuthError) {
    if (e.code === "unauthorized_client")
      return "Falta autorizar Search Console en la delegación de dominio: en admin.google.com → Seguridad → Controles de API → Delegación de todo el dominio, sumá el scope https://www.googleapis.com/auth/webmasters.readonly a la cuenta de servicio (sin sacar los que ya tiene).";
    return `Google rechazó la cuenta de servicio: ${e.message}`;
  }
  if (e instanceof SearchConsoleError) {
    if (e.reason === "SERVICE_DISABLED" || e.reason === "accessNotConfigured")
      return "La API de Google Search Console no está habilitada en el proyecto de Cloud de la cuenta de servicio. Habilitala en console.cloud.google.com → APIs y servicios.";
    if (e.status === 403)
      return "La cuenta no tiene acceso a esa propiedad de Search Console. Revisá que siga compartida con la cuenta del estudio.";
    if (e.status === 404) return "Search Console no encontró la propiedad. Puede que la hayan borrado: elegí otra.";
    if (e.status === 429) return "Search Console está limitando las consultas. Probá de nuevo en un minuto.";
    return `Search Console respondió con un error (${e.status}).`;
  }
  return "No se pudo consultar Search Console.";
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const user = process.env.GOOGLE_SEARCH_CONSOLE_USER?.trim() || null;
  const token = await googleAccessToken(user, SCOPE);
  const res = await fetch(`${API}${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("[search-console]", res.status, path, text.slice(0, 300));
    let reason: string | null = null;
    try {
      const err = JSON.parse(text)?.error;
      reason =
        err?.details?.find((d: { reason?: string }) => d?.reason)?.reason ?? err?.errors?.[0]?.reason ?? null;
    } catch {}
    throw new SearchConsoleError(text.slice(0, 200) || res.statusText, res.status, reason);
  }
  return (await res.json()) as T;
}

const site = (siteUrl: string) => `/sites/${encodeURIComponent(siteUrl)}`;

// ---------- Propiedades ----------

export type GscSite = {
  siteUrl: string;
  // "ejemplo.com" o "https://www.ejemplo.com/".
  label: string;
  kind: "domain" | "prefix";
  permission: string;
};

export const siteLabel = (siteUrl: string) => (siteUrl.startsWith("sc-domain:") ? siteUrl.slice(10) : siteUrl);

// El dominio de la propiedad, sin www, para compararlo con la web del cliente.
export function siteHost(siteUrl: string) {
  const raw = siteLabel(siteUrl);
  try {
    return new URL(raw.startsWith("http") ? raw : `https://${raw}`).hostname.replace(/^www\./, "");
  } catch {
    return raw.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  }
}

// Link a la propiedad en Search Console.
export const searchConsoleUrl = (siteUrl: string) =>
  `https://search.google.com/search-console?resource_id=${encodeURIComponent(siteUrl)}`;

export const listGscSites = unstable_cache(
  async (): Promise<GscSite[]> => {
    const body = await call<{ siteEntry?: { siteUrl: string; permissionLevel: string }[] }>("/sites");
    return (body.siteEntry ?? [])
      // Sin verificar no hay datos para leer.
      .filter((s) => s.siteUrl && s.permissionLevel !== "siteUnverifiedUser")
      .map((s) => ({
        siteUrl: s.siteUrl,
        label: siteLabel(s.siteUrl),
        kind: s.siteUrl.startsWith("sc-domain:") ? ("domain" as const) : ("prefix" as const),
        permission: s.permissionLevel,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "es"));
  },
  ["gsc-sites"],
  { revalidate: TTL, tags: [GSC_TAG] },
);

// ---------- Rendimiento ----------

export type GscMetrics = { clicks: number; impressions: number; ctr: number | null; position: number | null };
export type GscDay = GscMetrics & { date: string };
export type GscRow = GscMetrics & {
  key: string;
  // Del período anterior (null = no apareció).
  prevClicks: number | null;
  prevPosition: number | null;
};
export type GscSitemap = {
  path: string;
  lastSubmitted: string | null;
  lastDownloaded: string | null;
  pending: boolean;
  index: boolean;
  errors: number;
  warnings: number;
  // URLs que declara el sitemap (todas las de contenido web).
  submitted: number | null;
};

export type GscReport = {
  // Último día con datos dentro del período (null = sin datos).
  lastDate: string | null;
  // El período cortado en el último día con datos, y contra qué se compara.
  current: { since: string; until: string };
  previous: { since: string; until: string; label: string };
  totals: GscMetrics;
  previousTotals: GscMetrics | null;
  daily: GscDay[];
  queries: GscRow[];
  pages: GscRow[];
  devices: GscRow[];
  countries: GscRow[];
  sitemaps: GscSitemap[] | null;
};

type ApiRow = { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number };

async function analytics(siteUrl: string, since: string, until: string, dimensions: string[], rowLimit: number) {
  const body = await call<{ rows?: ApiRow[] }>(`${site(siteUrl)}/searchAnalytics/query`, {
    startDate: since,
    endDate: until,
    dimensions,
    rowLimit,
    type: "web",
    dataState: "all",
  });
  return body.rows ?? [];
}

// CTR sobre el total y posición promedio ponderada por impresiones: lo mismo que
// el total de Search Console para la propiedad.
function sum(rows: { clicks: number; impressions: number; position: number | null }[]): GscMetrics {
  const clicks = rows.reduce((a, r) => a + r.clicks, 0);
  const impressions = rows.reduce((a, r) => a + r.impressions, 0);
  const weighted = rows.reduce((a, r) => a + (r.position ?? 0) * r.impressions, 0);
  return {
    clicks,
    impressions,
    ctr: impressions ? (clicks / impressions) * 100 : null,
    position: impressions ? weighted / impressions : null,
  };
}

function withPrevious(rows: ApiRow[], before: ApiRow[]): GscRow[] {
  const prev = new Map(before.map((r) => [r.keys?.[0] ?? "", r]));
  return rows.map((r) => {
    const key = r.keys?.[0] ?? "";
    const p = prev.get(key);
    return {
      key,
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr * 100,
      position: r.position,
      prevClicks: p ? p.clicks : null,
      prevPosition: p ? p.position : null,
    };
  });
}

const int = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

async function sitemaps(siteUrl: string): Promise<GscSitemap[] | null> {
  try {
    const body = await call<{ sitemap?: Record<string, unknown>[] }>(`${site(siteUrl)}/sitemaps`);
    return (body.sitemap ?? []).map((s) => {
      const contents = Array.isArray(s.contents) ? (s.contents as { type?: string; submitted?: unknown }[]) : [];
      const web = contents.filter((c) => c.type === "web");
      return {
        path: String(s.path ?? ""),
        lastSubmitted: typeof s.lastSubmitted === "string" ? s.lastSubmitted : null,
        lastDownloaded: typeof s.lastDownloaded === "string" ? s.lastDownloaded : null,
        pending: !!s.isPending,
        index: !!s.isSitemapsIndex,
        errors: int(s.errors),
        warnings: int(s.warnings),
        submitted: web.length ? web.reduce((a, c) => a + int(c.submitted), 0) : null,
      };
    });
  } catch (e) {
    // Los sitemaps son un extra: sin ellos la solapa sigue.
    console.error("[search-console] sitemaps", e);
    return null;
  }
}

export const getSearchConsoleReport = unstable_cache(
  async (siteUrl: string, range: Period): Promise<GscReport> => {
    // Primero los días (del inicio del período anterior al final de este), para
    // saber hasta qué día hay datos.
    const widest = previousPeriod(range);
    const days = await analytics(siteUrl, widest.since, range.until, ["date"], 1000);
    const byDate = days
      .map((r) => ({ date: r.keys?.[0] ?? "", clicks: r.clicks, impressions: r.impressions, ctr: r.ctr * 100, position: r.position }))
      .filter((d) => d.date)
      .sort((a, b) => a.date.localeCompare(b.date));

    const lastDate = byDate.filter((d) => d.date >= range.since && d.date <= range.until).at(-1)?.date ?? null;
    const until = lastDate && lastDate < range.until ? lastDate : range.until;
    const cut: Period = until === range.until ? range : { ...range, until };
    const previous = previousPeriod(cut);

    const daily = byDate.filter((d) => d.date >= range.since && d.date <= until);
    const before = byDate.filter((d) => d.date >= previous.since && d.date <= previous.until);

    const empty = !lastDate;
    const [queries, queriesBefore, pages, pagesBefore, devices, countries, maps] = await Promise.all([
      empty ? [] : analytics(siteUrl, range.since, until, ["query"], QUERY_ROWS),
      empty ? [] : analytics(siteUrl, previous.since, previous.until, ["query"], QUERY_ROWS),
      empty ? [] : analytics(siteUrl, range.since, until, ["page"], PAGE_ROWS),
      empty ? [] : analytics(siteUrl, previous.since, previous.until, ["page"], PAGE_ROWS),
      empty ? [] : analytics(siteUrl, range.since, until, ["device"], 10),
      empty ? [] : analytics(siteUrl, range.since, until, ["country"], 10),
      sitemaps(siteUrl),
    ]);

    return {
      lastDate,
      current: { since: range.since, until },
      previous: { since: previous.since, until: previous.until, label: previous.label },
      totals: sum(daily),
      previousTotals: before.length ? sum(before) : null,
      daily,
      queries: withPrevious(queries, queriesBefore),
      pages: withPrevious(pages, pagesBefore),
      devices: withPrevious(devices, []),
      countries: withPrevious(countries, []),
      sitemaps: maps,
    };
  },
  ["gsc-report-v1"],
  { revalidate: TTL, tags: [GSC_TAG] },
);

// ---------- Nombres para la pantalla ----------

export const DEVICES: Record<string, string> = { MOBILE: "Celular", DESKTOP: "Computadora", TABLET: "Tablet" };

// Search Console da los países en ISO 3166 alfa-3 ("arg"): Intl los nombra en alfa-2.
const ISO3: Record<string, string> = {
  arg: "AR", ury: "UY", chl: "CL", pry: "PY", bol: "BO", per: "PE", col: "CO", ecu: "EC", ven: "VE", bra: "BR",
  mex: "MX", usa: "US", can: "CA", esp: "ES", ita: "IT", fra: "FR", deu: "DE", gbr: "GB", prt: "PT", nld: "NL",
  che: "CH", irl: "IE", isr: "IL", ind: "IN", chn: "CN", jpn: "JP", aus: "AU", cri: "CR", pan: "PA", gtm: "GT",
  dom: "DO", cub: "CU", slv: "SV", hnd: "HN", nic: "NI", pri: "PR", bel: "BE", swe: "SE", nor: "NO", dnk: "DK",
  pol: "PL", aut: "AT", rus: "RU", tur: "TR", zaf: "ZA", phl: "PH", idn: "ID", vnm: "VN", kor: "KR", are: "AE",
};
const regions = new Intl.DisplayNames(["es-AR"], { type: "region" });
export function countryName(code: string) {
  const iso2 = ISO3[code.toLowerCase()];
  if (!iso2) return code === "zzz" ? "Sin identificar" : code.toUpperCase();
  try {
    return regions.of(iso2) ?? iso2;
  } catch {
    return iso2;
  }
}
