import Link from "next/link";
import { NotionContent } from "@/components/notion-content";
import { SyncStatus } from "@/components/sync-status";
import { Topbar } from "@/components/topbar";
import { Card, EmptyState, MissingIntegration, NotConnected } from "@/components/ui";
import { type Client, getNotionConfig } from "@/lib/data";
import { getPortal, notionConfigured, notionErrorMessage, type Portal } from "@/lib/notion";
import { portalImageSrc } from "@/lib/notion-image";
import { isPortalConfigured } from "@/lib/notion-map";
import { attendeeName, calendarConfigured, getClientMeetings } from "@/lib/calendar";
import { getMeetingNotes } from "@/lib/meeting-notes";
import { isTabHidden } from "@/lib/client-tabs";
import { type ExtraEvent, withExtraEvents } from "@/lib/notion-blocks";

const TZ = "America/Argentina/Buenos_Aires";
const hour = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ });
const localDay = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });

// Reuniones con el cliente (Google Calendar) para la solapa "Reuniones" de la
// database del portal. Nada si Calendar no está configurado, si la solapa Reuniones está
// desactivada para quien mira, o si falla la lectura: el portal no depende de esto.
async function portalMeetings(client: Client, internal: boolean): Promise<ExtraEvent[]> {
  if (!calendarConfigured() || isTabHidden(client.hiddenTabs, internal ? "team" : "client", "reuniones")) return [];
  const [{ upcoming, past, error }, notes] = await Promise.all([
    getClientMeetings(client.name),
    getMeetingNotes(client.id),
  ]);
  if (error) return [];
  return [
    ...past.map((m) => ({ m, href: null, done: true })),
    ...upcoming.map((m) => ({ m, href: m.meetUrl, done: false })),
  ].map(({ m, href, done }) => {
    const people = m.attendees.map(attendeeName);
    return {
      id: `meet-${m.key}`,
      kind: "meeting" as const,
      title: m.reason ?? "Reunión",
      color: "default",
      day: m.allDay ? m.start.slice(0, 10) : localDay.format(new Date(m.start)),
      time: m.allDay ? undefined : hour.format(new Date(m.start)),
      subtitle: m.allDay ? "Todo el día" : `${hour.format(new Date(m.start))} – ${hour.format(new Date(m.end))} hs`,
      href,
      done,
      details: [
        { label: "Horario", value: m.allDay ? "Todo el día" : `${hour.format(new Date(m.start))} – ${hour.format(new Date(m.end))} hs` },
        ...(people.length ? [{ label: "Participantes", value: people.join(", ") }] : []),
      ],
      // Solo las ya hechas tienen descripción (la escribe el equipo en Reuniones).
      notes: done ? (notes.byKey[m.key]?.notes ?? null) : null,
    };
  });
}

// En Notion la página se llama "Portal del cliente - <Cliente>"; acá el nombre ya
// está en el encabezado, así que se le quita del final (con su separador). Si el
// título no termina así, queda como está.
function titleWithoutClient(title: string, clientName: string) {
  const name = clientName.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!name) return title;
  return title.replace(new RegExp(`\\s*[-–—|·:]\\s*${name}\\s*$`, "i"), "") || title;
}

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
        {!internal && <Topbar crumb={c.name} title={title} />}
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
          {!internal && <Topbar crumb={c.name} title={title} />}
          <section className="view">
            <NotConnected kind="notion" />
          </section>
        </>
      );
    }
    return (
      <>
        {!internal && <Topbar crumb={c.name} title={title} />}
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

  // En paralelo con Notion; nunca tira (sin reuniones, el portal sale igual).
  const meetingsPromise = portalMeetings(c, internal);
  let portal: Portal | null = null;
  let loadError: string | null = null;
  try {
    portal = await getPortal(config, projectId);
  } catch (e) {
    console.error("[notion] getPortal", e);
    loadError = notionErrorMessage(e);
  }
  const meetings = await meetingsPromise;

  const ok = portal?.state === "ok" ? portal : null;
  // Portada e ícono salen por una ruta propia con link estable, para que el
  // navegador los guarde (lib/notion-image.ts). La cuenta del cliente no puede
  // salir de /mi-empresa, así que tiene la suya.
  const imageBase = internal ? "/api/notion/img" : "/mi-empresa/portal/img";

  return (
    <>
      {!internal && <Topbar crumb={c.name} title={title} />}
      <section className="view">
        {/* El estado de la fuente solo aparece si Notion falló: andando bien, el
            portal no lleva el "Notion · En vivo" de las otras solapas. El botón de
            actualizar (solo equipo) está en el encabezado del cliente. */}
        {loadError && <SyncStatus source="Notion" live error={loadError} internal={internal} />}

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
              <img className="portal-cover" src={portalImageSrc(imageBase, ok.pageId, "cover", ok.cover)} alt="" fetchPriority="high" />
            )}
            <div className={`portal-head${ok.cover ? " with-cover" : ""}`}>
              {ok.icon && (
                <span className="portal-icon" aria-hidden>
                  {ok.icon.kind === "emoji" ? (
                    ok.icon.emoji
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={portalImageSrc(imageBase, ok.pageId, "icon", ok.icon.url)} alt="" />
                  )}
                </span>
              )}
              <h2>{titleWithoutClient(ok.title, c.name)}</h2>
            </div>

            {ok.blocks.length === 0 ? (
              <EmptyState label="Vacío">La página existe pero todavía no tiene contenido.</EmptyState>
            ) : (
              <NotionContent blocks={withExtraEvents(ok.blocks, meetings)} />
            )}
          </article>
        )}
      </section>
    </>
  );
}
