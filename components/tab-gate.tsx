import Link from "next/link";
import { redirect } from "next/navigation";
import { CLIENT_BASE, getClientZone } from "@/lib/client-zone";
import { CLIENT_TABS, isTabHidden, type TabKey } from "@/lib/client-tabs";
import { getClient } from "@/lib/data";
import { Icon } from "./icons";
import { Topbar } from "./topbar";

// Barrera de las solapas que se desactivan en "Editar cliente". Va en el
// layout.tsx de cada solapa: sacarla del sidebar no alcanza, se puede entrar por
// la URL. Solo server.

// Panel del equipo: en vez de la solapa, un aviso con el camino para activarla.
// Sin acceso al cliente (getClient lee con la RLS) sigue de largo y la página
// muestra su propio "Sin acceso".
export async function TeamTabGate({ slug, tab, children }: { slug: string; tab: TabKey; children: React.ReactNode }) {
  const client = await getClient(slug);
  if (!client || !isTabHidden(client.hiddenTabs, "team", tab)) return children;

  const label = CLIENT_TABS.find((t) => t.key === tab)?.team ?? tab;
  return (
    <>
      <Topbar crumb={client.name} title={label} />
      <section className="view">
        <div className="card connect-state">
          <div className="cs-ico">
            <Icon name="eye" />
          </div>
          <h3>Solapa desactivada</h3>
          <p>{label} está desactivada para este cliente en el panel del equipo.</p>
          <Link href={`/clientes/${client.slug}/editar`} className="link-connect">
            Activarla en Editar cliente →
          </Link>
        </div>
      </section>
    </>
  );
}

// Cuenta del cliente: una solapa desactivada no existe; vuelve a la vista general.
export async function ClientTabGate({ tab, children }: { tab: TabKey; children: React.ReactNode }) {
  const zone = await getClientZone();
  if (zone && isTabHidden(zone.client.hiddenTabs, "client", tab)) redirect(CLIENT_BASE);
  return children;
}
