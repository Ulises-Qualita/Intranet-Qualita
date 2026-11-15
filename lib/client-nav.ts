// Solapas del panel de un cliente para el equipo: el catálogo y las que ve cada
// quien. Sin imports de server. Lo usan el layout del cliente (la barra) y la
// entrada del panel interno de Qualita, que no tiene Vista general y abre en la
// primera solapa que haya.
import { type AreaKey, type Profile, canAccess } from "./auth-shared";
import { type HiddenTabs, type TabKey, isTabHidden } from "./client-tabs";
import { SHOW_TASKS } from "./tasks";

// Solo las vistas de consulta del cliente. Editar se entra desde la tabla de
// /clientes: es una acción de gestión, no una solapa que se mire a diario.
// tab: la clave con que se desactiva en "Editar cliente" (lib/client-tabs.ts);
// Vista general no tiene, siempre se ve.
export type ClientNavItem = { suffix: string; label: string; area: AreaKey; tab?: TabKey };

const CLIENT_NAV = (
  [
    { suffix: "", label: "Vista general", area: "clientes" },
    { suffix: "/meta", label: "META", area: "meta", tab: "meta" },
    // Google Ads: misma área que META (publicidad). Solo en el panel del equipo.
    { suffix: "/gads", label: "GADS", area: "meta", tab: "gads" },
    { suffix: "/crm", label: "CRM", area: "crm", tab: "crm" },
    // Sin área propia: analítica del sitio, para quien ya ve el panel del cliente.
    { suffix: "/web", label: "WEB", area: "clientes", tab: "web" },
    // Posiciones en buscadores (SE Ranking). Solo en el panel del equipo.
    { suffix: "/seo", label: "SEO", area: "clientes", tab: "seo" },
    { suffix: "/reuniones", label: "Reuniones", area: "clientes", tab: "reuniones" },
    // Sin área propia, como WEB: los archivos del cliente.
    { suffix: "/drive", label: "Repositorio", area: "clientes", tab: "drive" },
    // Videos tutoriales de las plataformas del cliente: una carpeta dentro de su Drive.
    { suffix: "/guias", label: "Guías", area: "clientes", tab: "guias" },
    // Solo en el panel del equipo: la cuenta del cliente no la tiene.
    { suffix: "/reportes", label: "Reportes", area: "clientes", tab: "reportes" },
    { suffix: "/tareas", label: "Tareas", area: "tareas", tab: "tareas" },
    { suffix: "/portal", label: "Calendario", area: "clientes", tab: "portal" },
    { suffix: "/equipo", label: "Equipo", area: "clientes", tab: "equipo" },
    // Brandbook del cliente. Para la cuenta del cliente arranca apagada.
    { suffix: "/marca", label: "Manual de marca", area: "clientes", tab: "marca" },
  ] satisfies ClientNavItem[]
).filter((item) => SHOW_TASKS || item.suffix !== "/tareas");

// Panel interno de Qualita (client.internal): no tiene Vista general ni estas
// solapas (pedido del usuario), y suma dos propias que todavía están en
// construcción (clientes/[id]/redes y /cerebros).
export const INTERNAL_OFF: readonly TabKey[] = ["meta", "gads", "crm", "reuniones", "drive", "reportes", "portal"];
const INTERNAL_EXTRA: ClientNavItem[] = [
  { suffix: "/redes", label: "Redes", area: "clientes" },
  { suffix: "/cerebros", label: "Cerebros", area: "clientes" },
];

// Las solapas que ve este usuario en el panel de este cliente, en orden.
export function teamNav(client: { internal: boolean; hiddenTabs: HiddenTabs }, profile: Profile | null): ClientNavItem[] {
  const list = client.internal
    ? [...CLIENT_NAV.filter((item) => item.suffix !== "" && !(item.tab && INTERNAL_OFF.includes(item.tab))), ...INTERNAL_EXTRA]
    : CLIENT_NAV;
  return list.filter((item) => canAccess(profile, item.area) && !(item.tab && isTabHidden(client.hiddenTabs, "team", item.tab)));
}
