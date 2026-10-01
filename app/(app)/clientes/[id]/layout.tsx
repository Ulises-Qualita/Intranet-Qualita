import { ClientHeader } from "@/components/client-header";
import { type ClientTab, ClientTabsBar } from "@/components/client-tabs-bar";
import { Topbar } from "@/components/topbar";
import { type AreaKey, canAccess } from "@/lib/auth-shared";
import { getSession } from "@/lib/auth";
import { isTabHidden, type TabKey } from "@/lib/client-tabs";
import { getClient, getTasks, isOpenTask } from "@/lib/data";
import { SHOW_TASKS } from "@/lib/tasks";

// Solo las vistas de consulta del cliente. Editar se entra desde la tabla de
// /clientes: es una acción de gestión, no una solapa que se mire a diario.
// tab: la clave con que se desactiva en "Editar cliente" (lib/client-tabs.ts);
// Vista general no tiene, siempre se ve.
type ClientNavItem = { suffix: string; label: string; area: AreaKey; tab?: TabKey };
const CLIENT_NAV = (
  [
    { suffix: "", label: "Vista general", area: "clientes" },
    { suffix: "/meta", label: "META", area: "meta", tab: "meta" },
    { suffix: "/crm", label: "CRM", area: "crm", tab: "crm" },
    // Sin área propia: analítica del sitio, para quien ya ve el panel del cliente.
    { suffix: "/web", label: "WEB", area: "clientes", tab: "web" },
    { suffix: "/reuniones", label: "Reuniones", area: "clientes", tab: "reuniones" },
    // Sin área propia, como WEB: los archivos del cliente.
    { suffix: "/drive", label: "Drive", area: "clientes", tab: "drive" },
    // Solo en el panel del equipo: la cuenta del cliente no la tiene.
    { suffix: "/reportes", label: "Reportes", area: "clientes", tab: "reportes" },
    { suffix: "/tareas", label: "Tareas", area: "tareas", tab: "tareas" },
    { suffix: "/portal", label: "Portal del cliente", area: "clientes", tab: "portal" },
    { suffix: "/equipo", label: "Equipo", area: "clientes", tab: "equipo" },
  ] satisfies ClientNavItem[]
).filter((item) => SHOW_TASKS || item.suffix !== "/tareas");

// Las solapas que se recortan por período (?dias= / ?desde=&hasta=, lib/period.ts).
// Ninguna de ellas puede tener un loading.tsx propio: ?dias= lo reiniciaría y el
// cambio de período volvería a vaciar la pantalla. Por lo mismo Vista general vive
// en el grupo (general)/ y no directo en [id]/, donde la tomaría el loading.tsx de
// las solapas.
const PERIOD_TABS = ["", "/meta", "/crm"];

// Panel de un cliente para el equipo. El encabezado (nombre, solapas y período) es
// de este layout, que no se vuelve a renderizar al navegar entre solapas: solo
// cambia el contenido de abajo. Por eso ninguna página bajo clientes/[id] dibuja
// su propio Topbar, y los loading.tsx de acá usan TabSkeleton (sin encabezado).
// Cada página sigue validando su área; esto solo arma la navegación.
export default async function ClienteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // getClient lee con la sesión (RLS): sin acceso al cliente queda un encabezado
  // genérico y la página muestra su "Sin acceso" o el 404.
  const [session, client] = await Promise.all([getSession(), getClient(id)]);
  const profile = session?.profile;
  if (!profile || !client || !canAccess(profile, "clientes")) {
    return (
      <div className="client-shell">
        <Topbar crumb="Qualita" title="Clientes" />
        <div className="client-content">{children}</div>
      </div>
    );
  }

  const seesTasks = SHOW_TASKS && canAccess(profile, "tareas");
  const openTasks = seesTasks ? (await getTasks()).filter((t) => t.client_id === client.id && isOpenTask(t)).length : 0;

  const base = `/clientes/${client.slug}`;
  // Ya conectada la integración, su pantalla de conexión sigue siendo donde se
  // ajusta (las etapas ganadas del CRM, la carpeta de Drive): un engranaje en la
  // barra, no un botón que ocupe lugar en la vista.
  const configFor = (suffix: string) =>
    suffix === "/crm" && client.conn.crm
      ? { href: `${base}/crm/conectar`, label: "Configurar CRM" }
      : suffix === "/drive" && client.conn.drive
        ? { href: `${base}/drive/conectar`, label: "Cambiar carpeta de Drive" }
        : undefined;
  const tabs: ClientTab[] = CLIENT_NAV.filter(
    (item) => canAccess(profile, item.area) && !(item.tab && isTabHidden(client.hiddenTabs, "team", item.tab)),
  ).map(({ suffix, label }) => ({
    suffix,
    label,
    badge: suffix === "/tareas" ? openTasks : undefined,
    config: configFor(suffix),
  }));

  return (
    <div className="client-shell">
      <div className="client-head">
        <ClientHeader client={client} />
        <ClientTabsBar base={base} tabs={tabs} periodTabs={PERIOD_TABS} />
      </div>
      <div className="client-content">{children}</div>
    </div>
  );
}
