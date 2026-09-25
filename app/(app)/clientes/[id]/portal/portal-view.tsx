import Link from "next/link";
import { NotionContent } from "@/components/notion-content";
import { Topbar } from "@/components/topbar";
import { Card, EmptyState, MissingIntegration, NotConnected } from "@/components/ui";
import { type Client, getNotionConfig } from "@/lib/data";
import { getPortal, notionConfigured, notionErrorMessage, type Portal } from "@/lib/notion";
import { isPortalConfigured } from "@/lib/notion-map";
import { RefreshPortalButton } from "./refresh-button";

// Portal del cliente (la página de Notion vinculada al proyecto): la intranet baja
// los bloques por la API y los dibuja con su propio diseño. Anda con la página sin
// publicar.
//
// La usan el equipo (/clientes/[slug]/portal) y la cuenta del propio cliente
// (/mi-empresa/portal): quien la llama ya validó el acceso. Con `internal` en
// false, lo que haya que arreglar en Notion se reduce a "todavía no disponible":
// las instrucciones son para el equipo.
export async function PortalView({ c, internal, isAdmin }: { c: Client; internal: boolean; isAdmin: boolean }) {
  const title = "Portal del cliente";

  const config = await getNotionConfig();
  const projectId = c.integrations.notion.connected ? c.integrations.notion.accountRef : null;

  // Sin proyecto vinculado no hay de dónde sacar el portal.
  if (!projectId) {
    return (
      <>
        <Topbar crumb={c.name} title={title} />
        <section className="view">
          <MissingIntegration kind="notion" client={c} internal={internal} />
        </section>
      </>
    );
  }

  if (!notionConfigured() || !isPortalConfigured(config)) {
    if (!internal) {
      return (
        <>
          <Topbar crumb={c.name} title={title} />
          <section className="view">
            <NotConnected kind="notion" />
          </section>
        </>
      );
    }
    return (
      <>
        <Topbar crumb={c.name} title={title} />
        <section className="view">
          <Card title="Portal del cliente" className="notion-connect">
            <div className="connect-state">
              <p>
                Falta decirle a la intranet qué propiedad de la database Proyectos guarda el link al portal del cliente.
              </p>
              {isAdmin ? (
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

  const ok = portal?.state === "ok" ? portal : null;

  return (
    <>
      <Topbar crumb={c.name} title={title} />
      <section className="view">
        {/* Solo el equipo: el link lleva al workspace de Notion de Qualita, que el
            cliente no puede abrir, y actualizar es una acción del equipo. */}
        {internal && (
          <div className="view-actions">
            <span className="muted">
              Página de Notion, en modo lectura.
              {ok && (
                <>
                  {" "}
                  <a href={ok.url} target="_blank" rel="noreferrer" className="link-connect-inline">
                    Abrir en Notion
                  </a>
                </>
              )}
            </span>
            <RefreshPortalButton />
          </div>
        )}

        {loadError && (
          <p className="form-error">
            {internal ? loadError : "No se pudo cargar el portal. Probá de nuevo en un rato."}
          </p>
        )}

        {!internal && (portal?.state === "missing" || portal?.state === "unreachable") && (
          <EmptyState label="Pendiente">El portal todavía no está disponible.</EmptyState>
        )}

        {internal && portal?.state === "missing" && (
          <EmptyState label="Sin portal">
            El proyecto de <b>{c.name}</b> en Notion no tiene cargado el link en la propiedad{" "}
            <b>{config.portalUrlProp}</b>. Pegá ahí la URL de la página del portal y volvé a entrar.
          </EmptyState>
        )}

        {internal && portal?.state === "unreachable" && (
          <EmptyState label="Sin acceso">
            El link está cargado, pero la integración de Notion no tiene acceso a esa página. Abrila en Notion y
            compartila desde el menú <b>•••　→　Conexiones</b>.
          </EmptyState>
        )}

        {ok && (
          <article className="portal-page">
            {/* Banner e ícono de la página, como los muestra Notion. */}
            {ok.cover && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="portal-cover" src={ok.cover} alt="" />
            )}
            <div className={`portal-head${ok.cover ? " with-cover" : ""}`}>
              {ok.icon && (
                <span className="portal-icon" aria-hidden>
                  {ok.icon.kind === "emoji" ? (
                    ok.icon.emoji
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={ok.icon.url} alt="" />
                  )}
                </span>
              )}
              <h2>{ok.title}</h2>
            </div>

            {ok.blocks.length === 0 ? (
              <EmptyState label="Vacío">La página existe pero todavía no tiene contenido.</EmptyState>
            ) : (
              <NotionContent blocks={ok.blocks} />
            )}
          </article>
        )}
      </section>
    </>
  );
}
