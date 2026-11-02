import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, NoAccess } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { getClient } from "@/lib/data";
import { listSites, seRankingConfigured, seRankingErrorMessage, type SeRankingSite } from "@/lib/seranking";
import { DisconnectSeRankingButton, SitePicker } from "./site-picker";

export default async function ConectarSeRankingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [session, client] = await Promise.all([getAreaSession("clientes"), getClient(id)]);
  if (!session) {
    return (
      <>
        <NoAccess />
      </>
    );
  }
  if (!client) notFound();

  let sites: SeRankingSite[] | null = null;
  let loadError: string | null = null;
  if (seRankingConfigured()) {
    try {
      sites = await listSites();
    } catch (e) {
      console.error("[seranking] listSites", e);
      loadError = seRankingErrorMessage(e);
    }
  }

  const state = client.integrations.seranking;
  const current = state.connected ? state.accountRef : null;
  const currentName = sites?.find((s) => s.id === current)?.title;

  return (
    <section className="view">
      <p className="back-link">
        <Link href={`/clientes/${client.slug}/seo`}>← Volver a SEO</Link>
      </p>

      <Card
        title={`Proyecto de SE Ranking · ${client.name}`}
        hint={state.connected ? `Vinculado: ${currentName ?? state.accountRef}` : undefined}
        action={state.connected ? <DisconnectSeRankingButton clientId={client.id} /> : undefined}
        className="notion-connect"
      >
        {!seRankingConfigured() ? (
          <div className="connect-state">
            <p>
              Falta la clave de API de SE Ranking. Creala en SE Ranking (menú API → crear clave de tipo Project) y cargala
              como <code>SERANKING_API_KEY</code> en las variables de entorno.
            </p>
          </div>
        ) : loadError ? (
          <p className="form-error">{loadError}</p>
        ) : sites && sites.length > 0 ? (
          <>
            <p className="modal-lead">
              Elegí el proyecto de SE Ranking del sitio de <b>{client.name}</b>. Sus posiciones se van a ver en la solapa
              SEO, solo para el equipo.
            </p>
            <SitePicker clientId={client.id} clientSlug={client.slug} sites={sites} currentSiteId={current} />
          </>
        ) : (
          <div className="connect-state">
            <p>La cuenta de SE Ranking no tiene proyectos. Creá el del cliente en SE Ranking y volvé acá.</p>
          </div>
        )}
      </Card>
    </section>
  );
}
