// Microsoft Clarity por su Data Export API. Solo server: usa el token del cliente.
//
// Límites de la API, que definen todo lo demás:
//   - 10 llamadas por proyecto por día.
//   - Solo los últimos 1, 2 o 3 días; no hay rango histórico.
//   - Hasta 3 dimensiones por llamada y 1.000 filas sin paginar.
//   - Solo números: heatmaps y grabaciones no se exponen por API.
// Por eso no se consulta al abrir la vista: el cron toma una foto por día
// (lib/clarity-sync.ts) y la serie se acumula en Supabase.
//
// Docs: https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-data-export-api
import { createAdminClient } from "./supabase/server";

const API = "https://www.clarity.ms/export-data/api/v1/project-live-insights";

export type ClaritySecrets = {
  token: string;
  // Id del proyecto en Clarity: identifica cuál quedó vinculado, nada más.
  project_id?: string;
  synced_at?: string;
  sync_error?: string | null;
};

export class ClarityError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// ---------- Secrets ----------

export async function getClaritySecrets(clientId: string): Promise<ClaritySecrets | null> {
  const { data } = await createAdminClient()
    .from("intranet_integration_secrets")
    .select("secrets")
    .eq("client_id", clientId)
    .eq("provider", "clarity")
    .maybeSingle<{ secrets: ClaritySecrets }>();
  return data?.secrets?.token ? data.secrets : null;
}

export async function saveClaritySecrets(clientId: string, secrets: ClaritySecrets) {
  const { error } = await createAdminClient()
    .from("intranet_integration_secrets")
    .upsert({ client_id: clientId, provider: "clarity", secrets, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function deleteClaritySecrets(clientId: string) {
  await createAdminClient().from("intranet_integration_secrets").delete().eq("client_id", clientId).eq("provider", "clarity");
}

// ---------- API ----------

export type ClarityMetric = { metricName: string; information: Record<string, unknown>[] };

export function clarityErrorMessage(e: unknown) {
  if (!(e instanceof ClarityError)) return "No se pudo leer Clarity.";
  if (e.status === 401) return "El token de Clarity es inválido o venció. Generá uno nuevo en Settings → Data Export.";
  if (e.status === 403) return "El token no tiene permiso sobre ese proyecto de Clarity.";
  if (e.status === 429) return "Se agotaron las 10 consultas diarias de Clarity para este proyecto. Vuelve a andar mañana.";
  return e.message;
}

async function query(token: string, params: Record<string, string>): Promise<ClarityMetric[]> {
  const url = new URL(API);
  url.searchParams.set("numOfDays", "1");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ClarityError(body.slice(0, 200) || `Clarity respondió ${res.status}`, res.status);
  }

  const data = await res.json().catch(() => null);
  // Un proyecto sin tráfico en las últimas 24 h responde 200 con una lista vacía.
  return Array.isArray(data) ? (data as ClarityMetric[]) : [];
}

// ---------- Traducción a números ----------

const clean = (name: string) => name.replace(/[\s_]/g, "").toLowerCase();

const findMetric = (metrics: ClarityMetric[], name: string) =>
  metrics.find((m) => clean(m.metricName ?? "") === clean(name));

const toNumber = (value: unknown): number | null => {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) ? n : null;
};

// La documentación de Clarity solo detalla los campos de la métrica Traffic. Para
// el resto se prueban los nombres conocidos y, si ninguno aparece, se toma el
// primer número de la fila: es preferible a devolver cero y dar un dato falso.
function readField(row: Record<string, unknown> | undefined, candidates: string[]): number | null {
  if (!row) return null;
  const byName = Object.entries(row).find(([key]) => candidates.some((c) => clean(c) === clean(key)));
  if (byName) return toNumber(byName[1]);

  const DIMENSIONS = new Set(["browser", "device", "os", "country/region", "source", "medium", "campaign", "channel", "url"]);
  const first = Object.entries(row).find(([key, value]) => !DIMENSIONS.has(clean(key)) && toNumber(value) !== null);
  return first ? toNumber(first[1]) : null;
}

const metricValue = (metrics: ClarityMetric[], name: string, candidates: string[]) =>
  readField(findMetric(metrics, name)?.information?.[0], candidates);

// Suma de todas las filas de una métrica: las de fricción vienen abiertas por
// página o por dimensión aunque no se pida ningún corte.
function metricTotal(metrics: ClarityMetric[], name: string, candidates: string[]): number {
  const rows = findMetric(metrics, name)?.information ?? [];
  return rows.reduce((total, row) => total + (readField(row, candidates) ?? 0), 0);
}

export type ClarityDay = {
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
  // Origen del tráfico: la URL de referencia (instagram.com, l.facebook.com…).
  sources: { name: string; sessions: number }[];
  raw: ClarityMetric[];
};

export type ClarityPage = { url: string; sessions: number };

// Un campo de la fila sin importar mayúsculas: Clarity no es consistente
// (distinctUserCount, pagesPerSessionPercentage…).
const field = (row: Record<string, unknown> | undefined, name: string) =>
  row ? Object.entries(row).find(([key]) => clean(key) === clean(name))?.[1] : undefined;

// Las listas que la respuesta general ya trae armadas (Device, ReferrerUrl,
// PopularPages…): [{ name|url, sessionsCount|visitsCount }], de mayor a menor.
function ranking(metrics: ClarityMetric[], metric: string, nameKey: string, countKey: string, fallback: string) {
  return (findMetric(metrics, metric)?.information ?? [])
    .map((row) => ({ name: String(field(row, nameKey) ?? fallback), sessions: toNumber(field(row, countKey)) ?? 0 }))
    .filter((d) => d.sessions > 0)
    .sort((a, b) => b.sessions - a.sessions);
}

// La foto del día sale entera de la respuesta general. También se usa para
// recalcular días viejos a partir de la columna raw.
export function parseClarityDay(overall: ClarityMetric[]): { day: ClarityDay; pages: ClarityPage[] } {
  const traffic = findMetric(overall, "Traffic")?.information ?? [];
  const sum = (key: string) => traffic.reduce((total, row) => total + (toNumber(field(row, key)) ?? 0), 0);

  const day: ClarityDay = {
    sessions: sum("totalSessionCount"),
    bot_sessions: sum("totalBotSessionCount"),
    distinct_users: sum("distinctUserCount"),
    // Pese al nombre, es la cantidad de páginas por sesión (p. ej. 1,39).
    pages_per_session: toNumber(field(traffic[0], "pagesPerSessionPercentage")),
    scroll_depth: metricValue(overall, "ScrollDepth", ["averageScrollDepth", "scrollDepth"]),
    total_time: metricValue(overall, "EngagementTime", ["totalTime", "totalEngagementTime"]),
    active_time: metricValue(overall, "EngagementTime", ["activeTime", "activeEngagementTime"]),
    rage_clicks: metricTotal(overall, "RageClickCount", ["sessionsWithRageClicks", "subTotal", "sessionsCount"]),
    dead_clicks: metricTotal(overall, "DeadClickCount", ["sessionsWithDeadClicks", "subTotal", "sessionsCount"]),
    excessive_scroll: metricTotal(overall, "ExcessiveScroll", ["sessionsWithExcessiveScrolls", "subTotal", "sessionsCount"]),
    quickbacks: metricTotal(overall, "QuickbackClick", ["sessionsWithQuickbackClick", "subTotal", "sessionsCount"]),
    script_errors: metricTotal(overall, "ScriptErrorCount", ["sessionsWithScriptErrors", "subTotal", "sessionsCount"]),
    error_clicks: metricTotal(overall, "ErrorClickCount", ["sessionsWithErrorClicks", "subTotal", "sessionsCount"]),
    devices: ranking(overall, "Device", "name", "sessionsCount", "Otro"),
    // Sin referencia = entró directo (URL tipeada, favorito, app que no la informa).
    sources: ranking(overall, "ReferrerUrl", "name", "sessionsCount", "Directo"),
    raw: overall,
  };

  // Visitas por página: la unidad es visitas, no sesiones (una sesión puede ver varias).
  const pages = ranking(overall, "PopularPages", "url", "visitsCount", "")
    .filter((p) => p.name)
    .slice(0, 25)
    .map((p) => ({ url: p.name, sessions: p.sessions }));

  return { day, pages };
}

// Foto del día: una sola llamada de las diez diarias. La respuesta general ya trae
// dispositivos, referencias y páginas; los cortes por dimensión no hacen falta.
export async function getClarityDay(token: string): Promise<{ day: ClarityDay; pages: ClarityPage[] }> {
  return parseClarityDay(await query(token, {}));
}

// Valida el token contra la API antes de guardarlo, para no dejar una integración
// "conectada" que en realidad no responde.
export async function checkClarityToken(token: string) {
  await query(token, {});
}
