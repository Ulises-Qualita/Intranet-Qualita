// Odoo por JSON-RPC (/jsonrpc). Solo server: usa la API key del cliente.
//
// Se eligió JSON-RPC y no XML-RPC porque se resuelve con fetch y JSON, sin
// dependencias. La API key se saca en Odoo desde Preferencias → Seguridad de la
// cuenta → Nueva clave de API, y vale como contraseña en las llamadas.
import { parseAmount, type CrmLead } from "./crm-shared";

export type OdooCredentials = {
  url: string;
  db: string;
  username: string;
  apiKey: string;
};

export class OdooError extends Error {}

// Oportunidades a traer: las abiertas más las cerradas de los últimos 90 días,
// que es lo que necesita el embudo y la tasa de conversión del período.
const LEAD_DAYS = 90;

const LEAD_FIELDS = [
  "id",
  "name",
  "partner_name",
  "stage_id",
  "source_id",
  "user_id",
  "expected_revenue",
  "probability",
  "priority",
  "active",
  "create_date",
  // Propiedades del lead: ahí va el "Ticket" que cargan los vendedores.
  "lead_properties",
] as const;

type OdooLeadRow = {
  id: number;
  name: string;
  partner_name?: string | false;
  stage_id?: [number, string] | false;
  source_id?: [number, string] | false;
  user_id?: [number, string] | false;
  expected_revenue?: number | false;
  probability?: number | false;
  priority?: string | false;
  active?: boolean;
  create_date?: string;
  lead_properties?: OdooProperty[] | false;
};

// Una propiedad de Odoo, tal como viene en lead_properties. El nombre técnico
// cambia según el equipo de ventas que la definió, así que se busca por etiqueta.
type OdooProperty = { name: string; string: string; type: string; value?: unknown };

// Propiedades que usa la intranet, por su etiqueta: el monto de la venta y el
// anuncio que originó la oportunidad.
const TICKET_PROPERTY = /^ticket$/i;
const AD_PROPERTY = /^anuncio$/i;

const propertyOf = (properties: OdooProperty[] | false | undefined, label: RegExp) =>
  (properties || []).find((p) => label.test(p.string))?.value;

const textOf = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

// La URL la carga un admin de la intranet; igual se valida el formato.
export function normalizeOdooUrl(raw: string) {
  const value = raw.trim().replace(/\/+$/, "");
  const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new OdooError("La dirección de Odoo no es válida.");
  return url.origin;
}

async function rpc<T>(url: string, service: string, method: string, args: unknown[]): Promise<T> {
  const res = await fetch(`${url}/jsonrpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: { service, method, args } }),
    cache: "no-store",
  });
  if (!res.ok) throw new OdooError(`Odoo respondió ${res.status}.`);

  const body = (await res.json().catch(() => null)) as { result?: T; error?: { data?: { message?: string } } } | null;
  if (!body) throw new OdooError("Odoo devolvió una respuesta que no se pudo leer.");
  if (body.error) throw new OdooError(body.error.data?.message || "Odoo rechazó la consulta.");
  return body.result as T;
}

// Bases de la instancia. Odoo Online lo bloquea; ahí devuelve null.
export async function listOdooDatabases(url: string): Promise<string[] | null> {
  try {
    const bases = await rpc<string[]>(url, "db", "list", []);
    return Array.isArray(bases) && bases.length ? bases : null;
  } catch {
    return null;
  }
}

// Odoo devuelve false para cualquier fallo de login, sin decir cuál. Se consulta
// la lista de bases para separar "la base no es esa" de "usuario o clave".
async function loginError({ url, db }: OdooCredentials) {
  const bases = await listOdooDatabases(url);
  if (bases && !bases.includes(db)) {
    return `La base de datos "${db}" no existe en ese Odoo. Están: ${bases.join(", ")}.`;
  }
  return "Usuario o clave de API incorrectos. La clave se crea en Odoo, en Preferencias → Seguridad de la cuenta → Nueva clave de API, con el mismo usuario que cargaste acá.";
}

// Sesión abierta contra Odoo. El idioma va en cada llamada: sin él, Odoo
// responde con los nombres base (en inglés y con los prefijos internos) en vez de
// los que el equipo ve en su CRM.
export type OdooSession = { creds: OdooCredentials; uid: number; lang: string };

// Devuelve el uid del usuario; false si las credenciales no sirven.
export async function odooLogin(creds: OdooCredentials) {
  const { url, db, username, apiKey } = creds;
  const uid = await rpc<number | false>(url, "common", "authenticate", [db, username, apiKey, {}]);
  if (!uid) throw new OdooError(await loginError(creds));
  return uid;
}

export async function odooConnect(creds: OdooCredentials): Promise<OdooSession> {
  const uid = await odooLogin(creds);
  const [user] = await query<{ lang?: string }[]>({ creds, uid, lang: "en_US" }, "res.users", "read", [[uid], ["lang"]]);
  return { creds, uid, lang: user?.lang || "en_US" };
}

async function query<T>(
  { creds, uid, lang }: OdooSession,
  model: string,
  method: string,
  args: unknown[],
  kwargs: { context?: Record<string, unknown>; [k: string]: unknown } = {},
) {
  const withLang = { ...kwargs, context: { lang, ...kwargs.context } };
  return rpc<T>(creds.url, "object", "execute_kw", [creds.db, uid, creds.apiKey, model, method, args, withLang]);
}

// Etapas del pipeline en el orden que tienen en Odoo: ordena el embudo.
export async function getOdooStages(session: OdooSession) {
  const rows = await query<{ id: number; name: string }[]>(session, "crm.stage", "search_read", [[], ["id", "name"]], {
    order: "sequence asc",
  });
  return rows.map((s) => s.name);
}

// Odoo marca la prioridad con estrellas ('0' a '3'); la intranet usa temperatura.
const temperatureOf = (priority: string | false | undefined, probability: number | false | undefined) => {
  if (priority === "3") return "hot";
  if (priority === "2") return "warm";
  if (typeof probability === "number" && probability >= 50) return "neg";
  return "new";
};

export async function getOdooOpportunities(session: OdooSession): Promise<CrmLead[]> {
  const since = new Date(Date.now() - LEAD_DAYS * 86_400_000).toISOString().slice(0, 19).replace("T", " ");
  const rows = await query<OdooLeadRow[]>(
    session,
    "crm.lead",
    "search_read",
    [
      ["&", ["type", "=", "opportunity"], "|", ["active", "=", true], ["create_date", ">=", since]],
      [...LEAD_FIELDS],
    ],
    // active_test en false trae también las archivadas (las perdidas).
    { context: { active_test: false }, order: "create_date desc", limit: 2000 },
  );

  return rows.map((r) => ({
    externalId: String(r.id),
    name: r.partner_name || r.name,
    stage: r.stage_id ? r.stage_id[1] : null,
    source: r.source_id ? r.source_id[1] : null,
    owner: r.user_id ? r.user_id[1] : null,
    // El importe real de la venta es el ticket; el ingreso esperado queda de respaldo.
    amount: parseAmount(propertyOf(r.lead_properties, TICKET_PROPERTY)) ?? parseAmount(r.expected_revenue),
    ad: textOf(propertyOf(r.lead_properties, AD_PROPERTY)),
    temperature: temperatureOf(r.priority, r.probability),
    createdAt: r.create_date ? `${r.create_date.replace(" ", "T")}Z` : new Date().toISOString(),
    // En Odoo las perdidas se archivan (active = false) y las ganadas quedan con
    // probabilidad 100. Ojo: si después se las mueve a una etapa posterior (en
    // fábrica, entregado…), Odoo les recalcula la probabilidad y dejan de figurar
    // como ganadas. Por eso el criterio final son las etapas elegidas por cliente.
    lost: r.active === false,
    wonByCrm: r.probability === 100 && r.active !== false,
  }));
}
