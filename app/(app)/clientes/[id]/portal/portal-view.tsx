import Link from "next/link";
import { DbViews } from "@/components/notion-content";
import { SyncStatus } from "@/components/sync-status";
import { Topbar } from "@/components/topbar";
import { EmptyState } from "@/components/ui";
import { attendeeName, calendarConfigured, getClientMeetings } from "@/lib/calendar";
import { isTabHidden } from "@/lib/client-tabs";
import { type Client, getNotionConfig, getPortalSettings } from "@/lib/data";
import { getMeetingNotes } from "@/lib/meeting-notes";
import { getTickets, notionConfigured, notionErrorMessage } from "@/lib/notion";
import { todayISO } from "@/lib/format";
import type { DbRow, EmbeddedDb, ExtraEvent } from "@/lib/notion-blocks";
import { isNotionConfigured, normalizeId, type NotionTicket } from "@/lib/notion-map";
import { bannerUrl } from "@/lib/portal";
import type { TaskStatus } from "@/lib/tasks";
import { PortalEditor } from "./portal-editor";
import { getMilestones } from "@/lib/milestones";
import { MilestoneTimeline } from "./milestone-timeline";
import { PortalProgress } from "./portal-progress";

const TZ = "America/Argentina/Buenos_Aires";
const hour = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ });
const localDay = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });

// Reuniones con el cliente (Google Calendar), en el calendario del roadmap y en su
// solapa "Reuniones". Nada si Calendar no está configurado, si la solapa Reuniones
// está desactivada para quien mira, o si falla la lectura: el portal no depende de esto.
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

type Roadmap =
  | { state: "ok"; tickets: NotionTicket[]; portalProp: string }
  // Sin proyecto de Notion vinculado, o sin Notion configurado en Administración.
  | { state: "no-project" }
  | { state: "no-config" }
  | { state: "error"; error: string };

// Tickets del calendario del portal: los del proyecto del cliente con el checkbox del
// portal tildado (portalPropOf en lib/notion-map.ts). getTickets() trae todo el
// estudio en una consulta cacheada; el filtro por proyecto va acá, por request.
async function portalRoadmap(client: Client): Promise<Roadmap> {
  const projectId = client.integrations.notion.connected ? client.integrations.notion.accountRef : null;
  if (!projectId) return { state: "no-project" };
  const config = await getNotionConfig();
  if (!notionConfigured() || !isNotionConfigured(config)) return { state: "no-config" };
  try {
    const project = normalizeId(projectId);
    const tickets = (await getTickets(config)).filter((t) => t.portal && t.projectIds.includes(project));
    return { state: "ok", tickets, portalProp: config.portalProp || "Portal de cliente" };
  } catch (e) {
    console.error("[portal] getTickets", e);
    return { state: "error", error: notionErrorMessage(e) };
  }
}

// El estado de Notion traducido para el cliente: los internos (Bloqueado,
// Feedback…) no se muestran, salen del mismo mapeo que usan las Tareas.
const STAGE_STATUS: Record<TaskStatus, { name: string; color: string }> = {
  todo: { name: "Pendiente", color: "gray" },
  doing: { name: "En curso", color: "blue" },
  blocked: { name: "En curso", color: "blue" },
  done: { name: "Completada", color: "green" },
};

// En Notion los tickets suelen llamarse "<Etapa> - <Cliente>"; acá el cliente ya
// está en el encabezado, así que se le quita del final (con su separador).
function withoutClient(title: string, clientName: string) {
  const name = clientName.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!name) return title;
  return title.replace(new RegExp(`\\s*[-–—|·:]\\s*${name}\\s*$`, "i"), "") || title;
}

// Los tickets armados como la database del roadmap de Notion, para dibujarlos con
// el mismo render (components/notion-content.tsx): solapa Calendario, más la de
// Reuniones si hay. La tabla de etapas no va: arriba ya están los hitos.
// `tickets` llega en orden de fecha (sortStages).
function roadmapDb(tickets: NotionTicket[], clientName: string, meetings: ExtraEvent[]): EmbeddedDb {
  const rows: DbRow[] = tickets.map((t) => ({
    id: t.id,
    cells: [
      { kind: "text", text: withoutClient(t.title, clientName) },
      { kind: "date", text: t.dueDate ?? "", ...(t.dueEnd ? { end: t.dueEnd } : {}) },
      { kind: "tags", tags: [STAGE_STATUS[t.status]] },
    ],
  }));
  return {
    columns: ["Tarea", "Fecha", "Estado"],
    rows,
    titleColumn: 0,
    dateColumn: 1,
    views: [
      { id: "calendario", name: "Calendario", kind: "calendar", dateColumn: 1 },
    ],
    extraEvents: meetings,
  };
}

// Primero lo que vence antes; sin fecha, al final.
const sortStages = (tickets: NotionTicket[]) =>
  [...tickets].sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.title.localeCompare(b.title, "es"));


const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

// Portal del cliente, armado en la intranet: banner y responsable validador los
// carga el equipo (intranet_clients.portal), el logo es el del cliente, y el
// roadmap sale de los tickets de Notion marcados para el portal más las reuniones
// de Google Calendar.
//
// Diseño en vidrio (como la solapa Hitos), sobre dos luces de marca: el banner
// grande con un vidrio apoyado en su borde (logo y bienvenida), el anillo de
// avance (etapas del proyecto), el calendario (tickets de Notion + reuniones; las
// reuniones no tienen card aparte), la línea de hitos y, al final, el responsable
// validador y la confidencialidad. Etapas e hitos se cargan en Editar portal.
//
// La usan el equipo (/clientes/[slug]/portal) y la cuenta del propio cliente
// (/mi-empresa/portal): quien la llama ya validó el acceso. Con `internal` en
// false, lo que falte configurar no se explica: las instrucciones son para el equipo.
export async function PortalView({ c, internal }: { c: Client; internal: boolean }) {
  const [{ settings, missing }, roadmap, meetings, { milestones, missingTable: milestonesMissing }] = await Promise.all([
    getPortalSettings(c.id),
    portalRoadmap(c),
    portalMeetings(c, internal),
    getMilestones(c.id),
  ]);
  const today = todayISO();

  const tickets = sortStages(roadmap.state === "ok" ? roadmap.tickets : []);
  const hasCalendar = tickets.length > 0 || meetings.length > 0;
  const db = roadmapDb(tickets, c.name, meetings);
  const v = settings.validator;

  // Lo que el equipo tiene que hacer para que los tickets aparezcan en el calendario.
  const roadmapHint =
    roadmap.state === "no-project" ? (
      <>
        Vinculá el proyecto de Notion de <b>{c.name}</b> para mostrar sus tickets en el calendario.{" "}
        <Link href={`/clientes/${c.slug}/notion/conectar`} className="link-connect">
          Vincular proyecto
        </Link>
      </>
    ) : roadmap.state === "no-config" ? (
      <>Falta configurar Notion en Administración → Notion para mostrar los tickets en el calendario.</>
    ) : roadmap.state === "ok" && !tickets.length ? (
      <>
        Ningún ticket del proyecto tiene tildado <b>{roadmap.portalProp}</b> en Notion. Tildalo en los que querés mostrar
        en el calendario.
      </>
    ) : null;

  const cover = settings.banner ? bannerUrl(c.id, settings.banner) : null;

  return (
    <>
      {!internal && <Topbar crumb={c.name} title="Portal del cliente" />}
      <section className="view">
        {roadmap.state === "error" && <SyncStatus source="Notion" live error={roadmap.error} internal={internal} />}

        {internal && missing && (
          <EmptyState label="Falta la base">
            Para cargar el banner y el responsable validador hay que correr <b>docs/sql/2026-10-05-portal-intranet.sql</b> en
            Supabase.
          </EmptyState>
        )}

        {internal && !missing && (
          <div className="portal-toolbar">
            <PortalEditor
              clientId={c.id}
              clientSlug={c.slug}
              validator={settings.validator}
              banner={cover}
              bannerPosition={settings.bannerPosition}
              stages={settings.stages}
              milestones={milestones}
              milestonesMissing={milestonesMissing}
            />
          </div>
        )}

        <div className="pt">
          {cover ? (
            // La parte que se ve la elige el equipo en "Editar portal".
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="pt-hero"
              src={cover}
              alt=""
              fetchPriority="high"
              style={{ objectPosition: `${settings.bannerPosition.x}% ${settings.bannerPosition.y}%` }}
            />
          ) : (
            <div className="pt-hero plain" aria-hidden />
          )}

          <header className="pt-glass pt-head">
            {c.logoUrl ? (
              <span className="pt-logo" aria-hidden>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.logoUrl} alt="" />
              </span>
            ) : (
              <span className="pt-logo initials" aria-hidden>
                {c.initials}
              </span>
            )}
            <div>
              <h2>Portal de cliente</h2>
              <p>
                Bienvenidos al portal de cliente x Qualita Studio. Acá van a encontrar en tiempo real el estado de avance,
                los próximos pasos y toda la documentación del proyecto.
              </p>
            </div>
          </header>

          {/* El % sale de las etapas que define el equipo en Editar portal → Etapas. */}
          {settings.stages.length > 0 ? (
            <PortalProgress stages={settings.stages} />
          ) : (
            internal && (
              <EmptyState label="Sin etapas">
                Definí las etapas del proyecto en <b>Editar portal → Etapas</b> para mostrar el avance.
              </EmptyState>
            )
          )}

          {internal && roadmapHint && <EmptyState label="Calendario">{roadmapHint}</EmptyState>}

          <div className="pt-grid">
            {hasCalendar && (
              <section className="pt-glass pt-pad pt-cal">
                <DbViews db={db} />
              </section>
            )}

            {/* Los hitos se cargan en Editar portal → Hitos. */}
            {milestones.length > 0 ? (
              <section className="pt-glass pt-pad" id="hitos">
                <div className="pt-sec">
                  <h3>Hitos</h3>
                </div>
                <MilestoneTimeline milestones={milestones} today={today} />
              </section>
            ) : (
              internal &&
              !milestonesMissing && (
                <EmptyState label="Sin hitos">
                  Este cliente todavía no tiene hitos. Cargalos en <b>Editar portal → Hitos</b>.
                </EmptyState>
              )
            )}

            <div className="pt-side">
              {v ? (
                <section className="pt-glass pt-pad">
                  <div className="pt-sec">
                    <h3>Responsable validador</h3>
                  </div>
                  <div className="pt-person">
                    <span className="pt-avatar" aria-hidden>
                      {initialsOf(v.name)}
                    </span>
                    <b>{v.name}</b>
                  </div>
                  {/* Los datos como texto, sin botón: el portal lo lee el cliente, y el
                      responsable es de su lado (no se van a escribir por acá). */}
                  <dl className="pt-facts">
                    {v.role && (
                      <div>
                        <dt>Cargo</dt>
                        <dd>{v.role}</dd>
                      </div>
                    )}
                    {v.phone && (
                      <div>
                        <dt>WhatsApp</dt>
                        <dd>{v.phone}</dd>
                      </div>
                    )}
                  </dl>
                  <p className="pt-note">Es la persona que aprueba los entregables.</p>
                </section>
              ) : (
                internal &&
                !missing && (
                  <EmptyState label="Sin cargar">
                    Falta el responsable validador. Cargalo desde <b>Editar portal</b>.
                  </EmptyState>
                )
              )}

              <section className="pt-glass pt-pad pt-confid">
                <span aria-hidden>🔒</span>
                <p>
                  <b>Proyecto confidencial.</b> Toda la información compartida en este portal es de uso exclusivo para el
                  proyecto.
                </p>
              </section>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
