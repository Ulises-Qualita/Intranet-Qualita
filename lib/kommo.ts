// Kommo por su API REST v4. Solo server: usa el token del cliente.
//
// Se conecta con un token de larga duración (1 día a 5 años), que genera un admin
// de Kommo en una integración privada → Claves y alcances. No tiene refresh: si
// vence o lo revocan, el sync falla con 401 y hay que cargar uno nuevo.
import { parseAmount, type CrmLead } from "./crm-shared";

export type KommoCredentials = {
  // Origen de la cuenta, p. ej. https://arteplac.kommo.com
  url: string;
  token: string;
};

export class KommoError extends Error {}

// Mismo criterio que Odoo: las abiertas más las cerradas de los últimos 90 días.
const LEAD_DAYS = 90;
const PAGE_LIMIT = 250;
// Tope de páginas por sync (10.000 leads): Kommo no permite pedir "abiertas o
// recientes" en una sola consulta, así que se recorre por fecha de creación.
const MAX_PAGES = 40;

// Kommo fija estas dos etapas en todas las cuentas y embudos.
const WON_STATUS = 142;
const LOST_STATUS = 143;

// Propiedades que usa la intranet, por nombre de campo (igual que en Odoo).
const TICKET_FIELD = /^ticket$/i;
const AD_FIELD = /^anuncio$/i;
// El origen sale de utm_source (campo de seguimiento que Kommo completa solo
// desde formularios y anuncios) y no de la "fuente" de Kommo: en Arteplac la
// fuente es la sucursal que recibió el lead, no el canal que lo trajo.
const UTM_SOURCE_FIELD = /^utm_source$/i;

// Los valores de utm_source vienen como los cargó cada campaña ("meta", "google",
// "ig"): se traducen al nombre del canal. Lo que no está acá se muestra tal cual.
const SOURCE_LABELS: Record<string, string> = {
  meta: "Meta",
  facebook: "Meta",
  fb: "Meta",
  google: "Google Ads",
  ig: "Instagram",
  instagram: "Instagram",
};

// Acepta el subdominio suelto ("arteplac"), el dominio o cualquier URL de la cuenta.
export function normalizeKommoUrl(raw: string) {
  const value = raw.trim().replace(/\/+$/, "");
  if (!value) throw new KommoError("Falta la cuenta de Kommo.");
  if (/^[a-z0-9-]+$/i.test(value)) return `https://${value.toLowerCase()}.kommo.com`;

  const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  if (!/\.(kommo\.com|amocrm\.(com|ru))$/i.test(url.hostname)) {
    throw new KommoError("La cuenta de Kommo no es válida (ej.: empresa.kommo.com).");
  }
  return `https://${url.hostname.toLowerCase()}`;
}

async function api<T>({ url, token }: KommoCredentials, path: string, params: Record<string, string | number> = {}) {
  const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const res = await fetch(`${url}/api/v4/${path}${query.size ? `?${query}` : ""}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  // Kommo responde 204 cuando una lista no tiene (más) resultados.
  if (res.status === 204) return null;
  if (res.status === 401) throw new KommoError("Kommo rechazó el token: puede haber vencido o haber sido revocado. Generá uno nuevo.");
  if (res.status === 403) throw new KommoError("El token de Kommo no tiene permiso para leer los leads. Tiene que generarlo un administrador.");
  if (res.status === 404) throw new KommoError("No se encontró esa cuenta de Kommo. Revisá el subdominio.");
  if (!res.ok) throw new KommoError(`Kommo respondió ${res.status}.`);
  return (await res.json()) as T;
}

// Prueba la conexión antes de guardar: devuelve el nombre de la cuenta.
export async function kommoAccount(creds: KommoCredentials) {
  const account = await api<{ name?: string; subdomain?: string }>(creds, "account");
  return account?.name || account?.subdomain || creds.url;
}

type KommoStatus = { id: number; name: string; sort: number };
type KommoPipeline = { id: number; name: string; sort: number; is_archive?: boolean; _embedded: { statuses: KommoStatus[] } };

// Etapas en el orden del CRM. Con más de un embudo se antepone el nombre del
// embudo: "Contactado" puede existir en varios y en la intranet se cuentan juntas.
// Ganada y perdida son comunes a todos y van sin prefijo.
async function getPipelines(creds: KommoCredentials) {
  const body = await api<{ _embedded: { pipelines: KommoPipeline[] } }>(creds, "leads/pipelines");
  const pipelines = (body?._embedded.pipelines ?? []).filter((p) => !p.is_archive).sort((a, b) => a.sort - b.sort);
  const several = pipelines.length > 1;

  const stageName = new Map<string, string>();
  const order: string[] = [];
  let won = "Ganada";
  let lost = "Perdida";
  for (const pipeline of pipelines) {
    for (const status of [...pipeline._embedded.statuses].sort((a, b) => a.sort - b.sort)) {
      if (status.id === WON_STATUS) won = status.name;
      else if (status.id === LOST_STATUS) lost = status.name;
      else {
        const name = several ? `${pipeline.name} · ${status.name}` : status.name;
        stageName.set(`${pipeline.id}:${status.id}`, name);
        order.push(name);
      }
    }
  }
  // Las cerradas van al final del embudo, una sola vez.
  order.push(won, lost);
  return { stageName, order, won, lost };
}

async function getUsers(creds: KommoCredentials) {
  const names = new Map<number, string>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await api<{ _embedded: { users: { id: number; name: string }[] } }>(creds, "users", { page, limit: PAGE_LIMIT });
    const users = body?._embedded.users ?? [];
    for (const u of users) names.set(u.id, u.name);
    if (users.length < PAGE_LIMIT) break;
  }
  return names;
}

type KommoField = { field_name?: string; field_code?: string | null; values?: { value?: unknown }[] };
type KommoLead = {
  id: number;
  name: string;
  price: number | null;
  status_id: number;
  pipeline_id: number;
  responsible_user_id: number | null;
  created_at: number;
  custom_fields_values: KommoField[] | null;
  _embedded?: {
    tags?: { name: string }[];
  };
};

// Por nombre o por código: los campos de seguimiento traen field_code (UTM_SOURCE)
// aunque alguien les cambie el nombre visible.
const fieldOf = (fields: KommoField[] | null, label: RegExp) =>
  (fields ?? []).find((f) => (f.field_name && label.test(f.field_name)) || (f.field_code && label.test(f.field_code)))
    ?.values?.[0]?.value;

const textOf = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

const sourceOf = (fields: KommoField[] | null) => {
  const raw = textOf(fieldOf(fields, UTM_SOURCE_FIELD));
  return raw ? (SOURCE_LABELS[raw.toLowerCase()] ?? raw) : null;
};

export async function readKommo(creds: KommoCredentials): Promise<{ leads: CrmLead[]; stages: string[] }> {
  const [pipelines, users] = await Promise.all([getPipelines(creds), getUsers(creds)]);
  const since = Math.floor(Date.now() / 1000) - LEAD_DAYS * 86_400;

  const leads: CrmLead[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await api<{ _embedded: { leads: KommoLead[] } }>(creds, "leads", {
      page,
      limit: PAGE_LIMIT,
      "order[created_at]": "desc",
    });
    const rows = body?._embedded.leads ?? [];

    for (const r of rows) {
      const won = r.status_id === WON_STATUS;
      const lost = r.status_id === LOST_STATUS;
      // Las cerradas viejas no suman al período; las abiertas se traen siempre.
      if ((won || lost) && r.created_at < since) continue;

      leads.push({
        externalId: String(r.id),
        name: r.name,
        stage: won ? pipelines.won : lost ? pipelines.lost : (pipelines.stageName.get(`${r.pipeline_id}:${r.status_id}`) ?? null),
        source: sourceOf(r.custom_fields_values),
        owner: r.responsible_user_id ? (users.get(r.responsible_user_id) ?? null) : null,
        ad: textOf(fieldOf(r.custom_fields_values, AD_FIELD)),
        tags: (r._embedded?.tags ?? []).map((t) => t.name).filter(Boolean),
        // El valor de venta es el campo nativo de Kommo; un "Ticket" propio, si lo
        // cargan, manda sobre él (mismo criterio que en Odoo).
        amount: parseAmount(fieldOf(r.custom_fields_values, TICKET_FIELD)) ?? parseAmount(r.price),
        temperature: "new",
        createdAt: new Date(r.created_at * 1000).toISOString(),
        lost,
        wonByCrm: won,
      });
    }
    if (rows.length < PAGE_LIMIT) break;
  }

  return { leads, stages: pipelines.order };
}
