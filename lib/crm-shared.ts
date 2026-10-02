// CRM del cliente. Sin imports de server: lo usan la pantalla de conexión y el sync.
//
// Cada cliente puede tener un CRM distinto (Disegno Milano usa Odoo, otros usan
// Kommo), así que el proveedor se guarda por cliente en los secrets de la
// integración `crm`, junto con sus credenciales.

export const CRM_PROVIDERS = [
  {
    value: "odoo",
    label: "Odoo",
    help: "La clave de API se saca en Odoo desde Preferencias → Seguridad de la cuenta → Nueva clave de API.",
    ready: true,
  },
  {
    value: "kommo",
    label: "Kommo",
    help: "Un administrador de Kommo crea una integración privada (Configuración → Integraciones → Crear integración) y, en Claves y alcances, genera un token de larga duración. Elegí un vencimiento largo: cuando vence hay que cargar uno nuevo.",
    ready: true,
  },
] as const;

export type CrmProvider = (typeof CRM_PROVIDERS)[number]["value"];

export const isCrmProvider = (value: unknown): value is CrmProvider =>
  CRM_PROVIDERS.some((p) => p.value === value && p.ready);

export const crmProviderLabel = (value: string) => CRM_PROVIDERS.find((p) => p.value === value)?.label ?? value;

// Lead ya traducido al modelo de la intranet, venga del CRM que venga.
export type CrmLead = {
  externalId: string;
  name: string;
  stage: string | null;
  source: string | null;
  // Vendedor a cargo, como lo nombra el CRM.
  owner: string | null;
  // Anuncio que originó la oportunidad; coincide con el nombre en Meta.
  ad: string | null;
  // Etiquetas, con el nombre que se ve en el CRM.
  tags: string[];
  amount: number | null;
  temperature: string;
  createdAt: string;
  // Último cambio de etapa, si el CRM lo informa (Odoo sí, Kommo no).
  stageChangedAt: string | null;
  // Cuándo se creó en el CRM el contacto del lead, si el CRM lo informa (Kommo sí).
  contactCreatedAt: string | null;
  // Teléfono del contacto reducido a sus últimos 10 dígitos: solo para detectar
  // duplicados durante el sync, no se guarda.
  phoneKey: string | null;
  // Cerrada como perdida (en Odoo, archivada).
  lost: boolean;
  // Lo que el propio CRM considera ganado, cuando no hay etapas elegidas a mano.
  wonByCrm: boolean;
};

// El monto de la venta lo cargan los vendedores a mano, así que llega como número
// o como texto con formato argentino ("$15.936.674.-", "$ 2.700.000"). Lo que no
// se pueda leer como importe positivo se descarta en vez de contarse como cero.
export function parseAmount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== "string") return null;

  let text = value.replace(/[^\d.,-]/g, "").replace(/[.,-]+$/, "");
  // Con coma decimal, el punto es separador de miles; sin ella, también lo es
  // cuando separa grupos de tres dígitos.
  text = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text.replace(/\.(?=\d{3}(\D|$))/g, "");

  const amount = Number(text);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

// Estado del lead en la intranet, ya resuelto contra las etapas elegidas.
export type CrmStatus = "open" | "won" | "lost";

// Una venta cuenta como ganada si está en alguna de las etapas que el equipo
// marcó para ese cliente; sin esa configuración, manda el criterio del CRM.
export function crmStatusOf(lead: CrmLead, wonStages: string[] | undefined): CrmStatus {
  if (lead.lost) return "lost";
  const won = wonStages?.length ? Boolean(lead.stage && wonStages.includes(lead.stage)) : lead.wonByCrm;
  return won ? "won" : "open";
}

// ---------- Qué leads cuentan como oportunidad nueva ----------

// No todo lo que el CRM tiene cargado como lead es una consulta nueva. Lo que cae
// en alguno de estos motivos se guarda igual (los chats lo necesitan), pero no
// entra en ninguna métrica:
// - stage: está en una etapa que el equipo marcó para no contar (pruebas internas).
// - before_start: se creó antes de que el cliente empezara a usar el CRM de
//   verdad; ese tramo está incompleto y sus etapas se cargaron después.
// - returning: el contacto ya existía en el CRM antes del lead. Al conectar un
//   WhatsApp, Kommo importa la agenda del teléfono: cuando uno de esos contactos
//   vuelve a escribir, nace un "lead nuevo" de alguien que ya era cliente.
// - duplicate: hay un lead anterior con el mismo teléfono.
export const CRM_EXCLUSIONS = ["stage", "before_start", "returning", "duplicate"] as const;
export type CrmExclusion = (typeof CRM_EXCLUSIONS)[number];

export const isCrmExclusion = (value: unknown): value is CrmExclusion =>
  CRM_EXCLUSIONS.includes(value as CrmExclusion);

export type CrmLeadBase = {
  // Día (YYYY-MM-DD, Argentina) desde el que el registro del CRM es completo.
  since?: string;
  excludedStages?: string[];
};

// Margen entre el alta del contacto y la del lead para tomarlo como un contacto
// que ya estaba: en un lead nuevo las dos altas salen juntas.
const RETURNING_GAP_MS = 24 * 60 * 60 * 1000;

// Motivo por el que cada lead no cuenta, por id del CRM. Los que cuentan no figuran.
export function crmExclusions(leads: CrmLead[], base: CrmLeadBase): Map<string, CrmExclusion> {
  const start = base.since ? Date.parse(`${base.since}T00:00:00-03:00`) : null;
  const excludedStages = new Set(base.excludedStages ?? []);

  // El primer lead de cada teléfono: los demás son el mismo cliente otra vez.
  const firstByPhone = new Map<string, CrmLead>();
  for (const lead of leads) {
    if (!lead.phoneKey) continue;
    const first = firstByPhone.get(lead.phoneKey);
    if (!first || lead.createdAt < first.createdAt) firstByPhone.set(lead.phoneKey, lead);
  }

  const excluded = new Map<string, CrmExclusion>();
  for (const lead of leads) {
    const created = Date.parse(lead.createdAt);
    if (lead.stage && excludedStages.has(lead.stage)) excluded.set(lead.externalId, "stage");
    else if (start !== null && created < start) excluded.set(lead.externalId, "before_start");
    else if (lead.contactCreatedAt && created - Date.parse(lead.contactCreatedAt) > RETURNING_GAP_MS) {
      excluded.set(lead.externalId, "returning");
    } else if (lead.phoneKey && firstByPhone.get(lead.phoneKey) !== lead) excluded.set(lead.externalId, "duplicate");
  }
  return excluded;
}
