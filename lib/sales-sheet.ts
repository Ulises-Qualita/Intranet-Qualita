// Ventas confirmadas desde una planilla de Google Sheets del cliente. Solo server.
//
// En algunos clientes la venta no es confiable en el CRM (Arteplac: la etapa
// CONFIRMADO y el "Presupuesto $" de Kommo los cargan a medias) y la fuente
// oficial es la planilla que mantienen los vendedores. Se lee con la cuenta de
// servicio actuando como GOOGLE_DRIVE_USER, igual que Drive: la planilla tiene que
// estar compartida con ese usuario. La API de Sheets acepta el scope de Drive que
// ya está en la delegación de dominio, pero hay que habilitarla en el proyecto de
// Cloud de la cuenta de servicio.
//
// La planilla tiene dos pestañas que se cruzan por número de proyecto:
// - Proyectos: número de proyecto, cliente, teléfono, total en pesos y en dólares.
// - Cotizaciones: número de proyecto, fecha de confirmación, vendedor y vía de contacto.
// Las columnas se buscan por el encabezado, no por la posición, así una columna
// nueva en el medio no rompe la lectura.
import { type CrmLead, parseAmount } from "./crm-shared";
import { googleAccessToken, googleConfigured, GoogleAuthError } from "./google";

const API = "https://sheets.googleapis.com/v4/spreadsheets";
const SCOPE = "https://www.googleapis.com/auth/drive";

export const salesSheetConfigured = () => googleConfigured() && Boolean(process.env.GOOGLE_DRIVE_USER);

// Id de la planilla a partir del link que se copia del navegador (o del id suelto).
export function sheetIdFrom(input: string): string | null {
  const text = input.trim();
  const id = text.match(/\/spreadsheets\/d\/([\w-]+)/)?.[1] ?? (/^[\w-]{20,200}$/.test(text) ? text : null);
  return id && /^[\w-]{20,200}$/.test(id) ? id : null;
}

// Una venta confirmada, como queda después de cruzar las dos pestañas.
export type SheetSale = {
  // Número de proyecto ("2026-4893"): la clave de la fila.
  project: string;
  customer: string | null;
  // Teléfono reducido a los últimos 10 dígitos, como phoneKey del CRM. No se guarda.
  phoneKey: string | null;
  // Día de confirmación del proyecto (YYYY-MM-DD).
  confirmedOn: string;
  ars: number | null;
  usd: number | null;
  seller: string | null;
  channel: string | null;
};

export type SheetRead = {
  title: string;
  sales: SheetSale[];
  // Proyectos sin fecha de confirmación en Cotizaciones: no entran en ningún período.
  undated: number;
};

async function sheetsFetch<T>(url: string): Promise<T> {
  let token: string;
  try {
    token = await googleAccessToken(process.env.GOOGLE_DRIVE_USER!, SCOPE);
  } catch (e) {
    if (e instanceof GoogleAuthError && e.code === "unauthorized_client") {
      throw new Error("La cuenta de servicio no tiene autorizado el permiso de Drive en la delegación de dominio.");
    }
    throw e;
  }
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const reason = body?.error?.details?.find((d: { reason?: string }) => d.reason)?.reason;
    if (reason === "SERVICE_DISABLED") {
      throw new Error("La API de Google Sheets no está habilitada en el proyecto de la cuenta de servicio.");
    }
    if (res.status === 404 || res.status === 403) {
      throw new Error(`No se encontró la planilla, o no está compartida con ${process.env.GOOGLE_DRIVE_USER}.`);
    }
    throw new Error(body?.error?.message ?? `Google Sheets respondió ${res.status}`);
  }
  return body as T;
}

// "Fecha confirmación de proyecto" → "fecha confirmacion de proyecto".
const norm = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9$]+/g, " ")
    .trim();

type Cell = string | number | boolean | undefined;

// Columna cuyo encabezado cumple el patrón; la primera que coincida.
function column(header: Cell[], pattern: RegExp) {
  return header.findIndex((h) => pattern.test(norm(h)));
}

const PROJECT = /^\d{4}-\d+$/;

// En Proyectos el número va en una columna sin encabezado: se reconoce por el
// formato de los valores ("2026-4893").
function projectColumn(header: Cell[], rows: Cell[][]) {
  const named = column(header, /^(nro|numero|n) (de )?proyecto$/);
  if (named !== -1) return named;
  const width = Math.max(header.length, ...rows.slice(0, 50).map((r) => r.length));
  for (let i = 0; i < width; i++) {
    const values = rows.map((r) => String(r[i] ?? "").trim()).filter(Boolean);
    if (values.length && values.filter((v) => PROJECT.test(v)).length / values.length > 0.8) return i;
  }
  return -1;
}

const text = (value: Cell) => (value === undefined || value === null ? null : String(value).trim() || null);

// La fecha llega como número de serie de Sheets (días desde el 30/12/1899) o,
// si alguien la tipeó como texto, como "15/1/2026".
function dateOf(value: Cell): string | null {
  if (typeof value === "number" && value > 0) {
    return new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000).toISOString().slice(0, 10);
  }
  const m = String(value ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${year}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

export function phoneKeyOf(value: Cell): string | null {
  // Los números que Sheets guarda como número (1162772000) también sirven.
  const digits = (typeof value === "number" ? Math.round(value).toString() : String(value ?? "")).replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(-10) : null;
}

export async function readSalesSheet(sheetId: string): Promise<SheetRead> {
  const meta = await sheetsFetch<{ properties: { title: string }; sheets: { properties: { title: string } }[] }>(
    `${API}/${sheetId}?fields=properties.title,sheets.properties.title`,
  );
  const tabs = meta.sheets.map((s) => s.properties.title);
  const projectsTab = tabs.find((t) => /^proyectos?$/.test(norm(t))) ?? tabs.find((t) => norm(t).includes("proyecto"));
  const quotesTab = tabs.find((t) => norm(t).startsWith("cotizacion"));
  if (!projectsTab || !quotesTab) {
    throw new Error('La planilla tiene que tener una pestaña "Proyectos" y otra "Cotizaciones".');
  }

  const params = new URLSearchParams({ valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "SERIAL_NUMBER" });
  for (const tab of [projectsTab, quotesTab]) params.append("ranges", `'${tab.replace(/'/g, "''")}'`);
  const { valueRanges } = await sheetsFetch<{ valueRanges: { values?: Cell[][] }[] }>(
    `${API}/${sheetId}/values:batchGet?${params}`,
  );
  const [[pHeader = [], ...pRows], [qHeader = [], ...qRows]] = valueRanges.map((r) => r.values ?? []);

  const p = {
    project: projectColumn(pHeader, pRows),
    customer: column(pHeader, /^(nombre|cliente)$/),
    phone: column(pHeader, /^telefono/),
    ars: column(pHeader, /^total valor (pesos|ar\$?)$/),
    usd: column(pHeader, /^total valor (usd|u\$d|dolares)$/),
  };
  const q = {
    project: column(qHeader, /^(nro|numero|n) (de )?proyecto$/),
    confirmed: column(qHeader, /^fecha (de )?confirmacion/),
    seller: column(qHeader, /^vendedor/),
    channel: column(qHeader, /^via de contacto/),
  };
  const missing = [
    p.project === -1 && "número de proyecto (Proyectos)",
    p.phone === -1 && "Teléfono (Proyectos)",
    p.ars === -1 && p.usd === -1 && "Total valor pesos / USD (Proyectos)",
    q.project === -1 && "Nro. de Proyecto (Cotizaciones)",
    q.confirmed === -1 && "Fecha confirmación de proyecto (Cotizaciones)",
  ].filter(Boolean);
  if (missing.length) throw new Error(`No se encontraron estas columnas en la planilla: ${missing.join(", ")}.`);

  const quotes = new Map<string, Cell[]>();
  for (const row of qRows) {
    const project = text(row[q.project]);
    if (project) quotes.set(project, row);
  }

  const sales: SheetSale[] = [];
  const seen = new Set<string>();
  let undated = 0;
  for (const row of pRows) {
    const project = text(row[p.project]);
    if (!project || !PROJECT.test(project) || seen.has(project)) continue;
    seen.add(project);
    const quote = quotes.get(project);
    const confirmedOn = quote ? dateOf(quote[q.confirmed]) : null;
    if (!confirmedOn) {
      undated++;
      continue;
    }
    sales.push({
      project,
      customer: p.customer === -1 ? null : text(row[p.customer]),
      phoneKey: phoneKeyOf(row[p.phone]),
      confirmedOn,
      ars: p.ars === -1 ? null : parseAmount(row[p.ars]),
      usd: p.usd === -1 ? null : parseAmount(row[p.usd]),
      seller: q.seller === -1 ? null : text(quote![q.seller]),
      channel: q.channel === -1 ? null : text(quote![q.channel]),
    });
  }

  return { title: meta.properties.title, sales, undated };
}

// Lead del CRM que originó cada venta, por número de proyecto. Se cruza por
// teléfono y solo con leads creados hasta el día de la confirmación (uno
// posterior es el cliente que volvió a escribir, no el origen). Entre varios, el
// que cuenta como oportunidad nueva y, si no, el más viejo.
export function matchSales(sales: SheetSale[], leads: CrmLead[], excluded: Map<string, unknown>) {
  const byPhone = new Map<string, CrmLead[]>();
  for (const lead of leads) {
    if (!lead.phoneKey) continue;
    byPhone.set(lead.phoneKey, [...(byPhone.get(lead.phoneKey) ?? []), lead]);
  }

  const matches = new Map<string, string>();
  for (const sale of sales) {
    if (!sale.phoneKey) continue;
    const end = Date.parse(`${sale.confirmedOn}T23:59:59-03:00`);
    const candidates = (byPhone.get(sale.phoneKey) ?? [])
      .filter((l) => Date.parse(l.createdAt) <= end)
      .sort(
        (a, b) =>
          Number(excluded.has(a.externalId)) - Number(excluded.has(b.externalId)) || a.createdAt.localeCompare(b.createdAt),
      );
    if (candidates.length) matches.set(sale.project, candidates[0].externalId);
  }
  return matches;
}
