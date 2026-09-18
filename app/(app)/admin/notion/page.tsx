import Link from "next/link";
import { Topbar } from "@/components/topbar";
import { Card, NoAccess } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { getNotionConfig } from "@/lib/data";
import { getDataSource, notionConfigured, notionErrorMessage, searchDataSources, type NotionDataSource, type NotionProperty } from "@/lib/notion";
import { NotionSetup } from "./notion-setup";

export default async function AdminNotionPage() {
  const session = await getAreaSession("admin");
  if (!session) {
    return (
      <>
        <Topbar crumb="Administración" title="Notion" />
        <NoAccess />
      </>
    );
  }

  const configured = notionConfigured();
  const [config, sources] = await Promise.all([
    getNotionConfig(),
    (async (): Promise<{ list: NotionDataSource[]; error: string | null }> => {
      if (!configured) return { list: [], error: null };
      try {
        return { list: await searchDataSources(), error: null };
      } catch (e) {
        console.error("[notion] searchDataSources", e);
        return { list: [], error: notionErrorMessage(e) };
      }
    })(),
  ]);

  // Schema de la database ya configurada, para que la pantalla abra con el mapeo
  // cargado sin esperar un viaje desde el navegador.
  const schemaOf = async (id: string | undefined): Promise<NotionProperty[]> => {
    if (!configured || !id) return [];
    try {
      return (await getDataSource(id)).properties;
    } catch (e) {
      console.error("[notion] getDataSource", e);
      return [];
    }
  };
  const [initialProperties, initialProjectProperties] = await Promise.all([
    schemaOf(config?.ticketsDataSourceId),
    schemaOf(config?.projectsDataSourceId),
  ]);

  return (
    <>
      <Topbar crumb="Administración" title="Notion" />
      <section className="view">
        <p className="back-link">
          <Link href="/admin">← Volver a Administración</Link>
        </p>

        <Card
          title="Tareas desde Notion"
          hint={config ? "Configurado" : "Sin configurar"}
          className="notion-setup"
        >
          {!configured ? (
            <div className="connect-state">
              <p>
                Falta el token de Notion en el servidor. Creá una <b>integración interna</b> en{" "}
                <a href="https://www.notion.so/profile/integrations" target="_blank" rel="noreferrer" className="link-connect">
                  notion.so/profile/integrations
                </a>
                , habilitale la lectura de contenido y de información de usuarios (incluido el email, que se usa para
                identificar al responsable de cada ticket), y guardá el secreto interno como{" "}
                <code>NOTION_TOKEN</code>.
              </p>
              <p>
                Después, en Notion, abrí las databases de <b>Proyectos</b> y <b>Tickets</b> y compartilas con la
                integración desde el menú <b>•••　→　Conexiones</b>. Sin ese paso Notion responde 404.
              </p>
            </div>
          ) : sources.error ? (
            <p className="form-error">{sources.error}</p>
          ) : sources.list.length === 0 ? (
            <div className="connect-state">
              <p>
                El token funciona pero la integración no tiene ninguna database compartida. En Notion, abrí las
                databases de <b>Proyectos</b> y <b>Tickets</b> y compartilas desde el menú <b>•••　→　Conexiones</b>.
              </p>
            </div>
          ) : (
            <NotionSetup
              sources={sources.list}
              config={config}
              initialProperties={initialProperties}
              initialProjectProperties={initialProjectProperties}
            />
          )}
        </Card>
      </section>
    </>
  );
}
