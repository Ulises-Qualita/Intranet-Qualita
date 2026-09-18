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
    help: "Todavía no está integrado.",
    ready: false,
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
  amount: number | null;
  temperature: string;
  createdAt: string;
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
