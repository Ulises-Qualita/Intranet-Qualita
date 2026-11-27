import { ClientHeader } from "@/components/client-header";
import { type ClientTab, ClientPeriodBar, ClientTabsBar } from "@/components/client-tabs-bar";
import { Topbar } from "@/components/topbar";
import { canAccess } from "@/lib/auth-shared";
import { getSession } from "@/lib/auth";
import { teamNav } from "@/lib/client-nav";
import { getClient, getTasks, isOpenTask } from "@/lib/data";
import { SHOW_TASKS } from "@/lib/tasks";
import { RefreshPortalButton } from "./portal/refresh-button";

// Las solapas que se recortan por período (?mes= / ?desde=&hasta=, lib/period.ts).
// Ninguna de ellas puede tener un loading.tsx propio: ?mes= lo reiniciaría y el
// cambio de período volvería a vaciar la pantalla. Por lo mismo Vista general vive
// en el grupo (general)/ y no directo en [id]/, donde la tomaría el loading.tsx de
// las solapas.
const PERIOD_TABS = ["", "/meta", "/gads", "/crm", "/seo"];

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
        : suffix === "/seo" && client.conn.search_console
          ? { href: `${base}/seo/conectar`, label: "Cambiar propiedad de Search Console" }
          : suffix === "/guias" && client.conn.drive && client.guidesFolder
          ? { href: `${base}/guias/conectar`, label: "Cambiar carpeta de guías" }
          : undefined;
  // El catálogo y el filtro por área y por solapas apagadas: lib/client-nav.ts
  // (el panel interno de Qualita tiene su propio juego de solapas).
  const tabs: ClientTab[] = teamNav(client, profile).map(({ suffix, label }) => ({
    suffix,
    label,
    badge: suffix === "/tareas" ? openTasks : undefined,
    config: configFor(suffix),
  }));

  return (
    <div className="client-shell">
      <div className="client-head">
        <ClientHeader client={client}>
          {/* Relee los tickets de Notion y las reuniones del portal. */}
          {tabs.some((t) => t.suffix === "/portal") && <RefreshPortalButton href={`${base}/portal`} />}
          <ClientPeriodBar base={base} tabs={tabs} periodTabs={PERIOD_TABS} />
        </ClientHeader>
        <ClientTabsBar base={base} tabs={tabs} />
      </div>
      <div className="client-content">{children}</div>
    </div>
  );
}
