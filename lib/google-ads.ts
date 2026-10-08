// Google Ads API. Solo server.
//
// Sin OAuth por usuario: la cuenta de servicio de lib/google.ts actúa como
// GOOGLE_ADS_USER (un usuario del estudio con acceso a la MCC) con el scope
// `adwords`, autorizado en la delegación de dominio. Todas las consultas entran
// por la MCC (GOOGLE_ADS_LOGIN_CUSTOMER_ID, header `login-customer-id`).
//
// El nivel de acceso (Test / Explorer / Basic / Standard) lo da el proyecto de
// Google Cloud de la cuenta de servicio, no el developer token: desde 2026-09-10
// el token es opcional y la API lo ignora (se manda igual si está). Un proyecto
// en Test solo puede consultar cuentas de prueba; con una real, Google responde
// CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION.
//
// Cada cliente tiene UNA cuenta de anuncios (intranet_client_integrations,
// provider "google_ads", account_ref = customer id de 10 dígitos, sin guiones).
// Solo se puede vincular una cuenta que cuelgue de la MCC.
import { googleAccessToken, googleConfigured, GoogleAuthError } from "./google";

const ADS_SCOPE = "https://www.googleapis.com/auth/adwords";
const API_VERSION = process.env.GOOGLE_ADS_API_VERSION || "v25";
const API = `https://googleads.googleapis.com/${API_VERSION}`;

// Un customer id son 10 dígitos; en la interfaz se escribe 123-456-7890.
export const normalizeCustomerId = (value: unknown) => {
  const digits = String(value ?? "").replace(/[\s-]/g, "");
  return /^\d{10}$/.test(digits) ? digits : null;
};

export const formatCustomerId = (id: string) => `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}`;

const loginCustomerId = () => normalizeCustomerId(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);

export const googleAdsConfigured = () => googleConfigured() && Boolean(process.env.GOOGLE_ADS_USER) && Boolean(loginCustomerId());

export class GoogleAdsError extends Error {
  // code: el errorCode de Google Ads (p. ej. CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION).
  constructor(
    message: string,
    readonly code: string | null = null,
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

// Mensajes para los errores que dependen de la configuración y no del pedido.
const KNOWN_ERRORS: Record<string, string> = {
  CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION:
    "El proyecto de Google Cloud de la intranet todavía tiene acceso de prueba: solo puede leer cuentas de prueba hasta que Google apruebe un nivel mayor.",
  USER_PERMISSION_DENIED: "El usuario de Google Ads de la intranet no tiene acceso a esa cuenta desde la MCC.",
  CUSTOMER_NOT_ENABLED: "La cuenta de Google Ads no está habilitada (cancelada o suspendida).",
  NOT_ADS_USER: "El usuario de la intranet no tiene una cuenta de Google Ads.",
};

type ErrorBody = {
  error?: {
    message?: string;
    status?: string;
    details?: { errors?: { errorCode?: Record<string, string>; message?: string }[] }[];
  };
};

const toError = (status: number, body: ErrorBody | null) => {
  const first = body?.error?.details?.flatMap((d) => d.errors ?? [])[0];
  const code = first?.errorCode ? (Object.values(first.errorCode)[0] ?? null) : null;
  const message = (code && KNOWN_ERRORS[code]) || first?.message || body?.error?.message || `Google Ads respondió ${status}`;
  return new GoogleAdsError(message, code, status);
};

async function adsFetch<T>(path: string, body: unknown): Promise<T> {
  let token: string;
  try {
    token = await googleAccessToken(process.env.GOOGLE_ADS_USER!, ADS_SCOPE);
  } catch (e) {
    if (e instanceof GoogleAuthError && e.code === "unauthorized_client") {
      throw new GoogleAdsError("Falta autorizar el scope de Google Ads en la delegación de dominio de la cuenta de servicio.", e.code);
    }
    throw e;
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "login-customer-id": loginCustomerId()!,
  };
  if (process.env.GOOGLE_ADS_DEVELOPER_TOKEN) headers["developer-token"] = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

  const res = await fetch(`${API}/${path}`, { method: "POST", headers, body: JSON.stringify(body), cache: "no-store" });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw toError(res.status, json);
  return json as T;
}

// Consulta GAQL contra una cuenta. Junta todas las páginas (10.000 filas cada una).
export async function gaql<Row = Record<string, unknown>>(customerId: string, query: string): Promise<Row[]> {
  const rows: Row[] = [];
  let pageToken: string | undefined;
  do {
    const page = await adsFetch<{ results?: Row[]; nextPageToken?: string }>(`customers/${customerId}/googleAds:search`, {
      query,
      ...(pageToken ? { pageToken } : {}),
    });
    rows.push(...(page.results ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return rows;
}

export type AdsAccount = {
  id: string;
  name: string;
  currency: string | null;
  timeZone: string | null;
  status: string | null;
  test: boolean;
};

type CustomerClientRow = {
  customerClient?: {
    id?: string;
    descriptiveName?: string;
    currencyCode?: string;
    timeZone?: string;
    status?: string;
    manager?: boolean;
    testAccount?: boolean;
  };
};

const ACCOUNT_FIELDS =
  "customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.time_zone, customer_client.status, customer_client.manager, customer_client.test_account";

const toAccount = ({ customerClient: c }: CustomerClientRow): AdsAccount | null =>
  c?.id && !c.manager
    ? {
        id: String(c.id),
        name: c.descriptiveName?.trim() || formatCustomerId(String(c.id)),
        currency: c.currencyCode ?? null,
        timeZone: c.timeZone ?? null,
        status: c.status ?? null,
        test: Boolean(c.testAccount),
      }
    : null;

// Cuentas de anuncios bajo la MCC, en cualquier nivel (también las que cuelgan de
// sub-MCCs). Las MCC en sí no se listan: no tienen anuncios.
export async function listAdsAccounts(): Promise<AdsAccount[]> {
  const rows = await gaql<CustomerClientRow>(loginCustomerId()!, `SELECT ${ACCOUNT_FIELDS} FROM customer_client`);
  return rows
    .map(toAccount)
    .filter((a): a is AdsAccount => a !== null)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

// Una cuenta puntual, solo si cuelga de la MCC (si no, null).
export async function getAdsAccount(customerId: string): Promise<AdsAccount | null> {
  const id = normalizeCustomerId(customerId);
  if (!id) return null;
  const rows = await gaql<CustomerClientRow>(
    loginCustomerId()!,
    `SELECT ${ACCOUNT_FIELDS} FROM customer_client WHERE customer_client.id = ${id}`,
  );
  return rows.map(toAccount).find((a) => a?.id === id) ?? null;
}

// ---------- Métricas ----------

export type AdsMetrics = {
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  conversions_value: number;
};

export type AdsDay = AdsMetrics & { date: string };

export type AdsCampaignDay = AdsMetrics & {
  campaign_id: string;
  date: string;
  name: string;
  status: string | null;
  channel: string | null;
};

type RawMetrics = {
  impressions?: string;
  clicks?: string;
  costMicros?: string;
  conversions?: number;
  conversionsValue?: number;
};

const METRIC_FIELDS = "metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value";

// Los enteros llegan como texto (int64) y el costo en millonésimas.
const toMetrics = (m: RawMetrics = {}): AdsMetrics => ({
  impressions: Number(m.impressions ?? 0),
  clicks: Number(m.clicks ?? 0),
  cost: Math.round(Number(m.costMicros ?? 0) / 10_000) / 100,
  conversions: Math.round(Number(m.conversions ?? 0) * 100) / 100,
  conversions_value: Math.round(Number(m.conversionsValue ?? 0) * 100) / 100,
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const between = (since: string, until: string) => {
  if (!ISO_DATE.test(since) || !ISO_DATE.test(until)) throw new GoogleAdsError("Rango de fechas inválido.");
  return `segments.date BETWEEN '${since}' AND '${until}'`;
};

// Totales de la cuenta por día. Los días sin actividad no vienen.
export async function getAdsDaily(customerId: string, since: string, until: string): Promise<AdsDay[]> {
  const rows = await gaql<{ segments?: { date?: string }; metrics?: RawMetrics }>(
    customerId,
    `SELECT segments.date, ${METRIC_FIELDS} FROM customer WHERE ${between(since, until)}`,
  );
  return rows.filter((r) => r.segments?.date).map((r) => ({ date: r.segments!.date!, ...toMetrics(r.metrics) }));
}

// Cada campaña por día, solo los días en que tuvo impresiones.
export async function getAdsCampaignDays(customerId: string, since: string, until: string): Promise<AdsCampaignDay[]> {
  const rows = await gaql<{
    campaign?: { id?: string; name?: string; status?: string; advertisingChannelType?: string };
    segments?: { date?: string };
    metrics?: RawMetrics;
  }>(
    customerId,
    `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, segments.date, ${METRIC_FIELDS} ` +
      `FROM campaign WHERE ${between(since, until)} AND metrics.impressions > 0`,
  );
  return rows
    .filter((r) => r.campaign?.id && r.segments?.date)
    .map((r) => ({
      campaign_id: String(r.campaign!.id),
      date: r.segments!.date!,
      name: r.campaign!.name ?? `Campaña ${r.campaign!.id}`,
      status: r.campaign!.status ?? null,
      channel: r.campaign!.advertisingChannelType ?? null,
      ...toMetrics(r.metrics),
    }));
}

export const ACCOUNT_STATUS: Record<string, string> = {
  ENABLED: "Activa",
  CANCELED: "Cancelada",
  SUSPENDED: "Suspendida",
  CLOSED: "Cerrada",
};

export const googleAdsErrorMessage = (e: unknown) => (e instanceof Error ? e.message : "No se pudo leer Google Ads.");
