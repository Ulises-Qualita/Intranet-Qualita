// SE Ranking (solapa SEO, solo equipo). Dos APIs con la misma clave:
// - Project API (rank tracker): las keywords que sigue el proyecto del cliente, sus
//   posiciones diarias y las de sus competidores. No gasta unidades.
//   https://seranking.com/api/project/project-management/
// - Data API (base de datos de SE Ranking): tráfico orgánico estimado, keywords
//   orgánicas y backlinks del dominio. Gasta unidades (~100 por consulta), por eso
//   se guarda un día.
//
// Una sola cuenta del estudio: la clave va en SERANKING_API_KEY (solo server) y
// cada cliente se vincula a un proyecto ("site") de esa cuenta
// (intranet_client_integrations, provider 'seranking', account_ref = site_id).
// Las posiciones se miden una vez por día: lo del rank tracker se guarda una hora y
// el botón Actualizar lo descarta (SERANKING_TAG).
//
// Formato de las respuestas (verificado contra la API el 2026-11-02):
// - /sites/positions: pos 0 = fuera del top que mide (depth, 100); `change` es
//   positivo cuando subió.
// - /competitors/positions: ahí "fuera" llega como pos 100 con url null.
// - Números a veces como string ("1300", "38").
import { unstable_cache } from "next/cache";
import { todayISO } from "./format";
import { shiftDate } from "./period";

const PROJECT = "https://api.seranking.com/v1/project-management";
const DATA = "https://api.seranking.com/v1";
export const SERANKING_TAG = "seranking";
const TTL = 3600;
const DATA_TTL = 86_400;
// Días de posiciones que se traen: alcanza para la mejor posición del mes y la evolución.
const POSITION_DAYS = 30;
const MAX_COMPETITORS = 8;

export const seRankingConfigured = () => !!process.env.SERANKING_API_KEY;

export class SeRankingError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// Mensaje para la pantalla, sin detalles técnicos de más.
export function seRankingErrorMessage(e: unknown): string {
  if (e instanceof SeRankingError) {
    if (e.status === 401 || e.status === 403)
      return "SE Ranking rechazó la clave de API (SERANKING_API_KEY). Revisá que sea una clave de tipo Project y que el plan incluya la API.";
    if (e.status === 404) return "SE Ranking no encontró el proyecto. Puede que lo hayan borrado: elegí otro.";
    if (e.status === 429) return "SE Ranking está limitando las consultas. Probá de nuevo en un minuto.";
    return `SE Ranking respondió con un error (${e.status}).`;
  }
  return "No se pudo consultar SE Ranking.";
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Máx. 5 consultas por segundo por clave: ante un 429 se espera y se reintenta una vez.
async function call<T>(base: string, path: string, query: Record<string, string | undefined> = {}, retry = true): Promise<T> {
  const key = process.env.SERANKING_API_KEY;
  if (!key) throw new SeRankingError("Falta SERANKING_API_KEY", 0);
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v) params.set(k, v);
  const url = `${base}${path}${params.size ? `?${params}` : ""}`;
  const res = await fetch(url, { headers: { Authorization: `Token ${key}`, Accept: "application/json" }, cache: "no-store" });
  if (res.status === 429 && retry) {
    await wait(1200);
    return call(base, path, query, false);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[seranking]", res.status, path, body.slice(0, 300));
    throw new SeRankingError(body.slice(0, 200) || res.statusText, res.status);
  }
  return (await res.json()) as T;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const list = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!obj(x)) : [];

const hostOf = (url: string) => {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  }
};

// ---------- Proyectos ----------

export type SeRankingSite = {
  id: string;
  title: string;
  url: string;
  keywords: number | null;
  active: boolean;
  // Reporte de solo lectura de SE Ranking (no pide login).
  guestLink: string | null;
};

export const listSites = unstable_cache(
  async (): Promise<SeRankingSite[]> => {
    const rows = list(await call<unknown>(PROJECT, "/sites"));
    return rows
      .map((r) => ({
        id: String(r.id ?? ""),
        title: str(r.title) ?? str(r.name) ?? String(r.id ?? ""),
        url: str(r.name) ?? "",
        keywords: num(r.keyword_count),
        active: r.is_active === undefined ? true : !!Number(r.is_active),
        guestLink: str(r.guest_link),
      }))
      .filter((s) => s.id)
      .sort((a, b) => a.title.localeCompare(b.title, "es"));
  },
  ["seranking-sites"],
  { revalidate: TTL, tags: [SERANKING_TAG] },
);

// Nombres de los buscadores ("Google Argentina"): la lista es fija, se guarda una semana.
const engineNames = unstable_cache(
  async (): Promise<Record<string, string>> => {
    const rows = list(await call<unknown>(PROJECT, "/system/search-engines"));
    return Object.fromEntries(rows.map((r) => [String(r.id), str(r.name) ?? ""]));
  },
  ["seranking-engine-names"],
  { revalidate: 7 * 86_400 },
);

// ---------- Rank tracker (Project API) ----------

export type SeRankingEngine = { id: string; label: string; keywords: number | null };

export type SeRankingKeyword = {
  id: string;
  name: string;
  // Última posición medida (null = fuera del top 100) y su cambio contra la
  // medición anterior (positivo = subió).
  position: number | null;
  change: number | null;
  // Mejor posición de los últimos 30 días (null = no entró nunca).
  best: number | null;
  volume: number | null;
  cpc: number | null;
  // Posición en el mapa (local pack) de Google, si aparece.
  map: number | null;
  url: string | null;
};

export type SeRankingDay = { date: string; top3: number; top10: number; top100: number };

export type SeRankingCompetitor = {
  domain: string;
  trust: number | null;
  top10: number;
  top100: number;
  avg: number | null;
};

export type SeRankingReport = {
  site: SeRankingSite | null;
  engine: SeRankingEngine | null;
  // Medición más reciente (YYYY-MM-DD).
  checkedAt: string | null;
  firstCheck: string | null;
  keywords: SeRankingKeyword[];
  days: SeRankingDay[];
  // Visibilidad (%) por día, del más viejo al más nuevo.
  visibility: { date: string; value: number }[];
  visibilityNow: number | null;
  indexed: number | null;
  trust: number | null;
  up: number | null;
  down: number | null;
  competitors: SeRankingCompetitor[];
};

type Positions = { date: string; pos: number | null }[];

function positionsOf(raw: unknown, notFound: (p: Record<string, unknown>) => boolean): Positions {
  return list(raw)
    .map((p) => ({ date: String(p.date ?? ""), pos: notFound(p) ? null : num(p.pos) }))
    .filter((p) => p.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}

const ranked = (pos: number | null): pos is number => pos !== null && pos > 0;

// Posiciones de un competidor en las keywords del proyecto: cuántas tiene en el
// top 10 y en el top 100, y su promedio entre las que rankea.
async function competitorStats(siteId: string, engineId: string | undefined, c: Record<string, unknown>): Promise<SeRankingCompetitor> {
  const domain = str(c.name) ?? hostOf(str(c.url) ?? "");
  const base: SeRankingCompetitor = { domain, trust: num(c.domain_trust), top10: 0, top100: 0, avg: null };
  try {
    const raw = await call<unknown>(PROJECT, "/competitors/positions", {
      site_id: siteId,
      competitor_id: String(c.id),
      site_engine_id: engineId,
    });
    const block = list(raw).find((b) => !engineId || String(b.site_engine_id) === engineId) ?? list(raw)[0];
    const last = list(block?.keywords)
      .map((k) => positionsOf(k.positions, (p) => !str(p.url) && (num(p.pos) ?? 0) >= 100).at(-1)?.pos ?? null)
      .filter(ranked);
    return {
      ...base,
      top10: last.filter((p) => p <= 10).length,
      top100: last.length,
      avg: last.length ? last.reduce((a, b) => a + b, 0) / last.length : null,
    };
  } catch (e) {
    console.error("[seranking] competitor", domain, e);
    return base;
  }
}

export const getSeRankingReport = unstable_cache(
  async (siteId: string): Promise<SeRankingReport> => {
    const today = todayISO();
    const [sites, names, summaryRaw, enginesRaw, competitorsRaw] = await Promise.all([
      listSites(),
      engineNames().catch(() => ({}) as Record<string, string>),
      call<unknown>(PROJECT, "/sites/summary", { site_id: siteId }),
      call<unknown>(PROJECT, "/sites/search-engines", { site_id: siteId }),
      call<unknown>(PROJECT, "/competitors", { site_id: siteId }).catch(() => []),
    ]);
    const site = sites.find((s) => s.id === siteId) ?? null;
    const summary = obj(Array.isArray(summaryRaw) ? list(summaryRaw)[0] : summaryRaw) ?? {};

    const engines: SeRankingEngine[] = list(enginesRaw).map((e) => ({
      id: String(e.site_engine_id ?? ""),
      label: names[String(e.search_engine_id)] || "Buscador",
      keywords: num(e.keyword_count),
    }));
    // Con más de un buscador se muestra el que más keywords sigue.
    const engine = [...engines].sort((a, b) => (b.keywords ?? 0) - (a.keywords ?? 0))[0] ?? null;

    const [positionsRaw, historyRaw] = await Promise.all([
      call<unknown>(PROJECT, "/sites/positions", {
        site_id: siteId,
        site_engine_id: engine?.id,
        date_from: shiftDate(today, POSITION_DAYS),
        date_to: today,
        with_landing_pages: "1",
      }),
      call<unknown>(PROJECT, "/sites/positions/history", {
        site_id: siteId,
        site_engine_id: engine?.id,
        type: "visibility_percent",
        date_from: shiftDate(today, 90),
        date_to: today,
      }).catch((e) => {
        // El gráfico es un extra: sin él la solapa sigue.
        console.error("[seranking] history", e);
        return null;
      }),
    ]);

    const block = list(positionsRaw).find((b) => !engine || String(b.site_engine_id) === engine.id) ?? list(positionsRaw)[0];
    const series = new Map<string, Positions>();
    const keywords: SeRankingKeyword[] = list(block?.keywords).map((k) => {
      const id = String(k.id ?? "");
      const positions = positionsOf(k.positions, (p) => (num(p.pos) ?? 0) <= 0);
      series.set(id, positions);
      const last = list(k.positions).sort((a, b) => String(a.date).localeCompare(String(b.date))).at(-1);
      const hits = positions.map((p) => p.pos).filter(ranked);
      const map = num(last?.map_position);
      return {
        id,
        name: str(k.name) ?? id,
        position: positions.at(-1)?.pos ?? null,
        change: num(last?.change),
        best: hits.length ? Math.min(...hits) : null,
        volume: num(k.volume),
        cpc: num(k.cpc),
        map: Number(last?.is_map) && map ? map : null,
        url: str(list(k.landing_pages).at(-1)?.url),
      };
    });

    // Cuántas keywords hubo en cada rango, día por día.
    const dates = [...new Set([...series.values()].flatMap((p) => p.map((x) => x.date)))].sort();
    const days: SeRankingDay[] = dates.map((date) => {
      const day = [...series.values()].map((p) => p.find((x) => x.date === date)?.pos ?? null).filter(ranked);
      return { date, top3: day.filter((p) => p <= 3).length, top10: day.filter((p) => p <= 10).length, top100: day.length };
    });

    const historySeries = list(historyRaw);
    const mine = historySeries.find((s) => engine && String(s.search_engine_id) === engine.id) ?? historySeries[0];
    const visibility = list(mine?.data)
      .map((p) => ({ date: String(p.date ?? ""), value: num(p.value) }))
      .filter((p): p is { date: string; value: number } => !!p.date && p.value !== null)
      .sort((a, b) => a.date.localeCompare(b.date));

    // Competidores: una consulta por cada uno, de a cuatro para no pasar el límite.
    const rivals = list(competitorsRaw).slice(0, MAX_COMPETITORS);
    const competitors: SeRankingCompetitor[] = [];
    for (let i = 0; i < rivals.length; i += 4) {
      competitors.push(...(await Promise.all(rivals.slice(i, i + 4).map((c) => competitorStats(siteId, engine?.id, c)))));
    }
    competitors.sort((a, b) => b.top10 - a.top10 || b.top100 - a.top100 || (a.avg ?? 1e9) - (b.avg ?? 1e9));

    return {
      site,
      engine,
      checkedAt: dates.at(-1) ?? null,
      firstCheck: dates[0] ?? null,
      keywords,
      days,
      visibility,
      visibilityNow: num(summary.visibility_percent),
      indexed: num(summary.index_google),
      trust: num(summary.domain_trust),
      up: num(summary.total_up),
      down: num(summary.total_down),
      competitors,
    };
  },
  ["seranking-report-v2"],
  { revalidate: TTL, tags: [SERANKING_TAG] },
);

// ---------- Dominio (Data API) ----------

// Base de datos regional de la Data API según el buscador del proyecto. Sin
// coincidencia, Argentina (la mayoría de los clientes).
const SOURCES: Record<string, string> = {
  argentina: "ar",
  uruguay: "uy",
  chile: "cl",
  paraguay: "py",
  bolivia: "bo",
  peru: "pe",
  colombia: "co",
  mexico: "mx",
  spain: "es",
  brazil: "br",
  usa: "us",
};
export function sourceFor(engineLabel: string | null | undefined): string {
  const label = (engineLabel ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return Object.entries(SOURCES).find(([country]) => label.includes(country))?.[1] ?? "ar";
}

export type SeRankingDomain = {
  domain: string;
  // Tráfico orgánico estimado por mes y lo que costaría en anuncios (USD).
  traffic: number | null;
  trafficValue: number | null;
  keywords: number | null;
  top10: number | null;
  newKeywords: number | null;
  lostKeywords: number | null;
  backlinks: number | null;
  refDomains: number | null;
  // Últimos 12 meses, del más viejo al más nuevo.
  history: { month: string; traffic: number; keywords: number }[];
};

export const getDomainReport = unstable_cache(
  async (domain: string, source: string): Promise<SeRankingDomain> => {
    const [overviewRaw, historyRaw, backlinksRaw] = await Promise.all([
      call<unknown>(DATA, "/domain/overview/db", { source, domain }),
      call<unknown>(DATA, "/domain/overview/history", { source, domain, type: "organic" }).catch(() => []),
      call<unknown>(DATA, "/backlinks/summary", { target: domain, mode: "domain" }).catch(() => null),
    ]);
    const organic = obj(obj(overviewRaw)?.organic);
    const backlinks = list(obj(backlinksRaw)?.summary)[0];
    const top = (k: string) => num(organic?.[k]) ?? 0;
    const history = list(historyRaw)
      .map((h) => ({
        month: `${num(h.year)}-${String(num(h.month)).padStart(2, "0")}`,
        traffic: num(h.traffic_sum) ?? 0,
        keywords: num(h.keywords_count) ?? 0,
      }))
      .filter((h) => /^\d{4}-\d{2}$/.test(h.month))
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-12);
    return {
      domain,
      traffic: num(organic?.traffic_sum),
      trafficValue: num(organic?.price_sum),
      keywords: num(organic?.keywords_count),
      top10: organic ? top("top1_5") + top("top6_10") : null,
      newKeywords: num(organic?.keywords_new_count),
      lostKeywords: num(organic?.keywords_lost_count),
      backlinks: num(backlinks?.backlinks),
      refDomains: num(backlinks?.refdomains),
      history,
    };
  },
  ["seranking-domain"],
  // Gasta unidades: una vez por día alcanza (la base se actualiza por mes).
  { revalidate: DATA_TTL },
);

export const domainOf = (site: SeRankingSite | null) => (site?.url ? hostOf(site.url) : null);
