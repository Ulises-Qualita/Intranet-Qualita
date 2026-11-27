import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, NoAccess } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { getClient } from "@/lib/data";
import {
  type GscSite,
  listGscSites,
  searchConsoleConfigured,
  searchConsoleErrorMessage,
  siteHost,
  siteLabel,
} from "@/lib/search-console";
import { DisconnectSearchConsoleButton, SitePicker } from "./site-picker";

export default async function ConectarSearchConsolePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [session, client] = await Promise.all([getAreaSession("clientes"), getClient(id)]);
  if (!session) return <NoAccess />;
  if (!client) notFound();

  let sites: GscSite[] | null = null;
  let loadError: string | null = null;
  if (searchConsoleConfigured()) {
    try {
      sites = await listGscSites();
    } catch (e) {
      console.error("[search-console] listGscSites", e);
      loadError = searchConsoleErrorMessage(e);
    }
  }

  const state = client.integrations.search_console;
  const current = state.connected ? state.accountRef : null;
  // La propiedad con el mismo dominio que la web del cliente va primero y elegida.
  const website = client.website ? siteHost(client.website) : null;
  const suggested = website ? (sites?.find((s) => siteHost(s.siteUrl) === website)?.siteUrl ?? null) : null;

  return (
    <section className="view">
      <p className="back-link">
        <Link href={`/clientes/${client.slug}/seo`}>← Volver a SEO</Link>
      </p>

      <Card
        title={`Propiedad de Search Console · ${client.name}`}
        hint={current ? `Vinculada: ${siteLabel(current)}` : undefined}
        action={current ? <DisconnectSearchConsoleButton clientId={client.id} /> : undefined}
        className="notion-connect"
      >
        {!searchConsoleConfigured() ? (
          <div className="connect-state">
            <p>
              Falta la cuenta de servicio de Google: cargá <code>GOOGLE_SERVICE_ACCOUNT_EMAIL</code> y{" "}
              <code>GOOGLE_SERVICE_ACCOUNT_KEY</code> en las variables de entorno.
            </p>
          </div>
        ) : loadError ? (
          <p className="form-error">{loadError}</p>
        ) : sites && sites.length > 0 ? (
          <>
            <p className="modal-lead">
              Elegí la propiedad de Search Console del sitio de <b>{client.name}</b>. Sus clics, búsquedas y páginas se van a
              ver en la solapa SEO, solo para el equipo.
            </p>
            <SitePicker
              clientId={client.id}
              clientSlug={client.slug}
              sites={sites}
              currentSite={current ?? suggested}
              suggested={suggested}
            />
          </>
        ) : (
          <div className="connect-state">
            <p>
              La cuenta de Search Console no tiene propiedades verificadas. Sumá la del cliente en Search Console y volvé
              acá.
            </p>
          </div>
        )}
      </Card>
    </section>
  );
}
