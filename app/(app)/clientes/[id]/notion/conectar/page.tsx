import Link from "next/link";
import { notFound } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { Card, NoAccess } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { getClient, getNotionConfig } from "@/lib/data";
import { listProjects, notionConfigured, notionErrorMessage, type NotionPageRef } from "@/lib/notion";
import { isNotionConfigured } from "@/lib/notion-map";
import { ProjectPicker } from "./project-picker";
import { DisconnectNotionButton } from "./disconnect-button";

export default async function ConectarNotionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getAreaSession("clientes");
  if (!session) {
    return (
      <>
        <Topbar crumb="Clientes" title="Conectar Notion" />
        <NoAccess />
      </>
    );
  }

  const client = await getClient(id);
  if (!client) notFound();

  const config = await getNotionConfig();
  const ready = notionConfigured() && isNotionConfigured(config);

  let projects: NotionPageRef[] | null = null;
  let loadError: string | null = null;
  if (ready) {
    try {
      projects = await listProjects(config.projectsDataSourceId);
    } catch (e) {
      console.error("[notion] listProjects", e);
      loadError = notionErrorMessage(e);
    }
  }

  const state = client.integrations.notion;
  const current = state.connected ? state.accountRef : null;
  const currentName = projects?.find((p) => p.id === current)?.title;

  return (
    <>
      <Topbar crumb={client.name} title="Conectar Notion" />
      <section className="view">
        <p className="back-link">
          <Link href={`/clientes/${client.slug}/tareas`}>← Volver a Tareas</Link>
        </p>

        <Card
          title={`Proyecto de Notion · ${client.name}`}
          hint={state.connected ? `Vinculado: ${currentName ?? state.accountRef}` : undefined}
          action={state.connected ? <DisconnectNotionButton clientId={client.id} /> : undefined}
          className="notion-connect"
        >
          {!ready ? (
            <div className="connect-state">
              <p>
                Todavía no está configurada la conexión con Notion del estudio: falta elegir las databases de Proyectos
                y Tickets y mapear sus propiedades.
              </p>
              {session.profile?.role === "admin" ? (
                <Link href="/admin/notion" className="connect-btn">
                  Configurar Notion
                </Link>
              ) : (
                <p className="muted">Pedile a un administrador que la configure desde Administración → Notion.</p>
              )}
            </div>
          ) : loadError ? (
            <p className="form-error">{loadError}</p>
          ) : projects && projects.length > 0 ? (
            <>
              <p className="modal-lead">
                Elegí a qué proyecto de Notion corresponde <b>{client.name}</b>. Sus tickets se van a ver en la solapa
                Tareas, en modo lectura: Notion sigue siendo la fuente de verdad.
              </p>
              <ProjectPicker
                clientId={client.id}
                clientSlug={client.slug}
                projects={projects}
                currentProjectId={current}
              />
            </>
          ) : (
            <div className="connect-state">
              <p>
                La database de Proyectos no tiene páginas, o la integración no tiene acceso a ellas. Revisá en Notion
                que esté compartida con la integración.
              </p>
            </div>
          )}
        </Card>
      </section>
    </>
  );
}
