import Link from "next/link";
import { notFound } from "next/navigation";
import { NotionContent } from "@/components/notion-content";
import { Topbar } from "@/components/topbar";
import { Card, ConnectState, EmptyState, NoAccess } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { getClient, getNotionConfig } from "@/lib/data";
import { getPortal, notionConfigured, notionErrorMessage, type Portal } from "@/lib/notion";
import { isPortalConfigured } from "@/lib/notion-map";
import { RefreshPortalButton } from "./refresh-button";

export default async function ClientePortalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getAreaSession("clientes");
  if (!session) {
    return (
      <>
        <Topbar crumb="Clientes" title="Portal del cliente" />
        <NoAccess />
      </>
    );
  }

  const c = await getClient(id);
  if (!c) notFound();

  const config = await getNotionConfig();
  const projectId = c.integrations.notion.connected ? c.integrations.notion.accountRef : null;

  // Sin proyecto vinculado no hay de dónde sacar el portal.
  if (!projectId) {
    return (
      <>
        <Topbar crumb={c.name} title="Portal del cliente" />
        <section className="view">
          <ConnectState kind="notion" client={c} />
        </section>
      </>
    );
  }

  if (!notionConfigured() || !isPortalConfigured(config)) {
    return (
      <>
        <Topbar crumb={c.name} title="Portal del cliente" />
        <section className="view">
          <Card title="Portal del cliente" className="notion-connect">
            <div className="connect-state">
              <p>
                Falta decirle a la intranet qué propiedad de la database Proyectos guarda el link al portal del cliente.
              </p>
              {session.profile?.role === "admin" ? (
                <Link href="/admin/notion" className="connect-btn">
                  Configurar Notion
                </Link>
              ) : (
                <p className="muted">Pedile a un administrador que lo configure desde Administración → Notion.</p>
              )}
            </div>
          </Card>
        </section>
      </>
    );
  }

  let portal: Portal | null = null;
  let loadError: string | null = null;
  try {
    portal = await getPortal(config, projectId);
  } catch (e) {
    console.error("[notion] getPortal", e);
    loadError = notionErrorMessage(e);
  }

  // Embebida: el iframe ocupa el alto libre y el scroll es suyo. Sin esto la
  // página de afuera también scrollea y quedan dos barras.
  const embedded = portal?.state === "ok" && !!portal.embedUrl;

  return (
    <>
      {/* Embebido, el link va en la topbar y se saca la barra de acciones: es
          alto que le gana el iframe, y la info no se repite. */}
      <Topbar crumb={c.name} title="Portal del cliente">
        {embedded && portal?.state === "ok" && (
          <a href={portal.url} target="_blank" rel="noreferrer" className="link-connect-inline">
            Abrir en Notion
          </a>
        )}
      </Topbar>
      <section className={`view${embedded ? " view-fill" : ""}`}>
        {!embedded && (
          <div className="view-actions">
            <span className="muted">
              Página de Notion, en modo lectura.
              {portal?.state === "ok" && (
                <>
                  {" "}
                  <a href={portal.url} target="_blank" rel="noreferrer" className="link-connect-inline">
                    Abrir en Notion
                  </a>
                </>
              )}
            </span>
            <RefreshPortalButton />
          </div>
        )}

        {loadError && <p className="form-error">{loadError}</p>}

        {portal?.state === "missing" && (
          <EmptyState label="Sin portal">
            El proyecto de <b>{c.name}</b> en Notion no tiene cargado el link en la propiedad{" "}
            <b>{config.portalUrlProp}</b>. Pegá ahí la URL de la página del portal y volvé a entrar.
          </EmptyState>
        )}

        {portal?.state === "unreachable" && (
          <EmptyState label="Sin acceso">
            El link está cargado, pero la integración de Notion no tiene acceso a esa página. Abrila en Notion y
            compartila desde el menú <b>•••　→　Conexiones</b>.
          </EmptyState>
        )}

        {/* Publicada en Notion: se embebe y queda idéntica. */}
        {portal?.state === "ok" && portal.embedUrl && (
          <iframe
            className="portal-frame"
            src={portal.embedUrl}
            title={`Portal de ${c.name}`}
            loading="lazy"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          />
        )}

        {portal?.state === "ok" && !embedded && (
          <article className="portal-page">
            {/* Banner e ícono de la página, como los muestra Notion. */}
            {portal.cover && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="portal-cover" src={portal.cover} alt="" />
            )}
            <div className={`portal-head${portal.cover ? " with-cover" : ""}`}>
              {portal.icon && (
                <span className="portal-icon" aria-hidden>
                  {portal.icon.kind === "emoji" ? (
                    portal.icon.emoji
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={portal.icon.url} alt="" />
                  )}
                </span>
              )}
              <h2>{portal.title}</h2>
            </div>

            {portal.blocks.length === 0 ? (
              <EmptyState label="Vacío">La página existe pero todavía no tiene contenido.</EmptyState>
            ) : (
              <NotionContent blocks={portal.blocks} />
            )}
          </article>
        )}
      </section>
    </>
  );
}
