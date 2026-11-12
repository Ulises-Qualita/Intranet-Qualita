// Solapas de cada cliente que se pueden activar o desactivar desde "Editar
// cliente", por separado para el panel del equipo y para la cuenta del cliente.
// Sin imports de server: lo usan el sidebar, la zona del cliente y el editor.
//
// Se guardan las OCULTAS (intranet_clients.hidden_tabs), no las visibles: una
// solapa nueva aparece activa en todos los clientes sin migrar nada (salvo las de
// CLIENT_DEFAULT_OFF, que para la cuenta del cliente arrancan apagadas).
// "Vista general" no está acá: es la entrada al cliente y siempre se ve.

export const CLIENT_TABS = [
  { key: "meta", team: "META", client: "META" },
  { key: "gads", team: "GADS", client: "GADS" },
  { key: "crm", team: "CRM", client: "CRM" },
  { key: "web", team: "WEB", client: "WEB" },
  { key: "seo", team: "SEO", client: null },
  { key: "reuniones", team: "Reuniones", client: "Reuniones" },
  { key: "drive", team: "Repositorio", client: "Repositorio" },
  { key: "guias", team: "Guías", client: "Guías" },
  { key: "tareas", team: "Tareas", client: null },
  { key: "portal", team: "Calendario", client: "Calendario" },
  { key: "equipo", team: "Equipo", client: "Equipo" },
  { key: "reportes", team: "Reportes", client: null },
  // Arranca apagada para la cuenta del cliente (CLIENT_DEFAULT_OFF).
  { key: "marca", team: "Manual de marca", client: "Manual de marca" },
] as const;

export type TabKey = (typeof CLIENT_TABS)[number]["key"];
export type TabZone = "team" | "client";
export type HiddenTabs = Record<TabZone, TabKey[]>;

export const NO_HIDDEN_TABS: HiddenTabs = { team: [], client: [] };

export const isTabKey = (value: unknown): value is TabKey => CLIENT_TABS.some((t) => t.key === value);

// La solapa existe en esa zona (Tareas y Reportes son solo del equipo).
export const tabInZone = (key: TabKey, zone: TabZone) => !!CLIENT_TABS.find((t) => t.key === key)?.[zone];

export const isTabHidden = (hidden: HiddenTabs, zone: TabZone, key: TabKey) => hidden[zone].includes(key);

// Solapas que arrancan APAGADAS para la cuenta del cliente (las del equipo
// siempre arrancan prendidas). Como se guardan las ocultas, para estas se guarda
// además `clientShown`: los clientes en los que alguien la prendió a mano.
export const CLIENT_DEFAULT_OFF: readonly TabKey[] = ["marca"];

// Lo que venga de la base, normalizado: claves desconocidas afuera, sin repetidos.
export function parseHiddenTabs(raw: unknown): HiddenTabs {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const keys = (value: unknown) => (Array.isArray(value) ? [...new Set(value.filter(isTabKey))] : []);
  const list = (zone: TabZone) => keys(obj[zone]).filter((k) => tabInZone(k, zone));
  const shown = keys(obj.clientShown);
  const defaultOff = CLIENT_DEFAULT_OFF.filter((k) => !shown.includes(k));
  return { team: list("team"), client: [...new Set([...list("client"), ...defaultOff])] };
}

// Lo que se guarda al prender o apagar una solapa, a partir de lo guardado.
export function applyTabChange(raw: unknown, zone: TabZone, tab: TabKey, visible: boolean) {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const hidden = parseHiddenTabs(raw);
  hidden[zone] = visible ? hidden[zone].filter((k) => k !== tab) : [...new Set([...hidden[zone], tab])];
  let shown = Array.isArray(obj.clientShown) ? obj.clientShown.filter(isTabKey) : [];
  if (zone === "client" && CLIENT_DEFAULT_OFF.includes(tab)) {
    shown = visible ? [...new Set([...shown, tab])] : shown.filter((k) => k !== tab);
  }
  return { ...hidden, clientShown: shown };
}
