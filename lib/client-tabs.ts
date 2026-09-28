// Solapas de cada cliente que se pueden activar o desactivar desde "Editar
// cliente", por separado para el panel del equipo y para la cuenta del cliente.
// Sin imports de server: lo usan el sidebar, la zona del cliente y el editor.
//
// Se guardan las OCULTAS (intranet_clients.hidden_tabs), no las visibles: una
// solapa nueva aparece activa en todos los clientes sin migrar nada.
// "Vista general" no está acá: es la entrada al cliente y siempre se ve.

export const CLIENT_TABS = [
  { key: "meta", team: "META", client: "META" },
  { key: "crm", team: "CRM", client: "CRM" },
  { key: "web", team: "WEB", client: "WEB" },
  { key: "reuniones", team: "Reuniones", client: "Reuniones" },
  { key: "tareas", team: "Tareas", client: null },
  { key: "portal", team: "Portal del cliente", client: "Portal" },
  { key: "equipo", team: "Equipo", client: "Equipo" },
  { key: "reportes", team: "Reportes", client: null },
] as const;

export type TabKey = (typeof CLIENT_TABS)[number]["key"];
export type TabZone = "team" | "client";
export type HiddenTabs = Record<TabZone, TabKey[]>;

export const NO_HIDDEN_TABS: HiddenTabs = { team: [], client: [] };

export const isTabKey = (value: unknown): value is TabKey => CLIENT_TABS.some((t) => t.key === value);

// La solapa existe en esa zona (Tareas y Reportes son solo del equipo).
export const tabInZone = (key: TabKey, zone: TabZone) => !!CLIENT_TABS.find((t) => t.key === key)?.[zone];

export const isTabHidden = (hidden: HiddenTabs, zone: TabZone, key: TabKey) => hidden[zone].includes(key);

// Lo que venga de la base, normalizado: claves desconocidas afuera, sin repetidos.
export function parseHiddenTabs(raw: unknown): HiddenTabs {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = (zone: TabZone) =>
    Array.isArray(obj[zone]) ? [...new Set((obj[zone] as unknown[]).filter(isTabKey))].filter((k) => tabInZone(k, zone)) : [];
  return { team: list("team"), client: list("client") };
}
