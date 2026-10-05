import Link from "next/link";
import { NotionContent } from "@/components/notion-content";
import { SyncStatus } from "@/components/sync-status";
import { Topbar } from "@/components/topbar";
import { EmptyState } from "@/components/ui";
import { attendeeName, calendarConfigured, getClientMeetings } from "@/lib/calendar";
import { isTabHidden } from "@/lib/client-tabs";
import { type Client, getNotionConfig, getPortalSettings } from "@/lib/data";
import { getMeetingNotes } from "@/lib/meeting-notes";
import { getTickets, notionConfigured, notionErrorMessage } from "@/lib/notion";
import type { BlockNode, DbRow, EmbeddedDb, ExtraEvent, RichText } from "@/lib/notion-blocks";
import { isNotionConfigured, normalizeId, type NotionTicket } from "@/lib/notion-map";
import { bannerUrl, type PortalValidator, whatsappHref } from "@/lib/portal";
import type { TaskStatus } from "@/lib/tasks";
import { PortalEditor } from "./portal-editor";

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

// Etapas del portal: los tickets del proyecto del cliente con el checkbox del
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
// el mismo render (components/notion-content.tsx): solapas Calendario y Etapas,
// más la de Reuniones si hay. `tickets` llega en orden de fecha (sortStages).
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
    columns: ["Etapa", "Fecha", "Estado"],
    rows,
    titleColumn: 0,
    dateColumn: 1,
    views: [
      { id: "calendario", name: "Calendario", kind: "calendar", dateColumn: 1 },
      { id: "etapas", name: "Etapas", kind: "table", tableColumns: [0, 1, 2] },
    ],
    extraEvents: meetings,
  };
}

const t = (text: string, extra: Partial<RichText> = {}): RichText[] => [{ text, ...extra }];

// Primero lo que vence antes; sin fecha, al final.
const sortStages = (tickets: NotionTicket[]) =>
  [...tickets].sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.title.localeCompare(b.title, "es"));

function validatorBlocks(v: PortalValidator): BlockNode[] {
  const wa = v.phone ? whatsappHref(v.phone) : null;
  return [
    { id: "validator-h", type: "heading_2", text: t("🙋 Responsable validador") },
    { id: "validator-name", type: "paragraph", text: t(v.name, { bold: true }) },
    ...(v.role ? [{ id: "validator-role", type: "paragraph" as const, text: t(`Cargo: ${v.role}`) }] : []),
    ...(v.phone
      ? [{ id: "validator-phone", type: "paragraph" as const, text: [{ text: "WhatsApp: " }, { text: v.phone, href: wa }] }]
      : []),
    { id: "validator-note", type: "paragraph", text: t("Es la persona que aprueba los entregables de cada etapa.") },
  ];
}

// Portal del cliente, armado en la intranet: banner y responsable validador los
// carga el equipo (intranet_clients.portal), el logo es el del cliente, y el
// roadmap sale de los tickets de Notion marcados para el portal más las reuniones
// de Google Calendar.
//
// La usan el equipo (/clientes/[slug]/portal) y la cuenta del propio cliente
// (/mi-empresa/portal): quien la llama ya validó el acceso. Con `internal` en
// false, lo que falte configurar no se explica: las instrucciones son para el equipo.
export async function PortalView({ c, internal }: { c: Client; internal: boolean }) {
  const [{ settings, missing }, roadmap, meetings] = await Promise.all([
    getPortalSettings(c.id),
    portalRoadmap(c),
    portalMeetings(c, internal),
  ]);

  const stages = sortStages(roadmap.state === "ok" ? roadmap.tickets : []);
  const hasRoadmap = stages.length > 0 || meetings.length > 0;
  const roadmapBlock: BlockNode = {
    id: "roadmap",
    type: "child_database",
    text: t("Roadmap"),
    db: roadmapDb(stages, c.name, meetings),
  };

  // Lo que el equipo tiene que hacer para que aparezcan las etapas.
  const roadmapHint =
    roadmap.state === "no-project" ? (
      <>
        Vinculá el proyecto de Notion de <b>{c.name}</b> para mostrar sus etapas.{" "}
        <Link href={`/clientes/${c.slug}/notion/conectar`} className="link-connect">
          Vincular proyecto
        </Link>
      </>
    ) : roadmap.state === "no-config" ? (
      <>Falta configurar Notion en Administración → Notion para mostrar las etapas.</>
    ) : roadmap.state === "ok" && !stages.length ? (
      <>
        Ningún ticket del proyecto tiene tildado <b>{roadmap.portalProp}</b> en Notion. Tildalo en los que querés mostrar
        en el calendario y en las etapas.
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
            <PortalEditor clientId={c.id} validator={settings.validator} banner={cover} />
          </div>
        )}

        <article className="portal-page">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="portal-cover" src={cover} alt="" fetchPriority="high" />
          ) : (
            <div className="portal-cover plain" aria-hidden />
          )}
          <div className="portal-head with-cover">
            {c.logoUrl ? (
              <span className="portal-icon logo" aria-hidden>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.logoUrl} alt="" />
              </span>
            ) : (
              <span className="portal-icon initials" aria-hidden>
                {c.initials}
              </span>
            )}
            <h2>Portal de cliente</h2>
          </div>

          <NotionContent
            blocks={[
              {
                id: "welcome",
                type: "paragraph",
                text: t(
                  "Bienvenidos al portal de cliente x Qualita Studio. Acá van a encontrar en tiempo real el estado de avance, los próximos pasos y toda la documentación del proyecto.",
                ),
              },
              ...(hasRoadmap ? [roadmapBlock] : []),
            ]}
          />

          {/* Al equipo se le dice por qué no hay etapas aunque el calendario tenga
              reuniones; al cliente, solo que todavía no hay nada. */}
          {internal && roadmapHint ? (
            <EmptyState label="Sin etapas">{roadmapHint}</EmptyState>
          ) : (
            !hasRoadmap && <EmptyState label="Pendiente">Todavía no hay etapas cargadas.</EmptyState>
          )}

          {internal && !missing && !settings.validator && (
            <EmptyState label="Sin cargar">
              Falta el responsable validador. Cargalo desde <b>Editar portal</b>.
            </EmptyState>
          )}

          <NotionContent
            blocks={[
              ...(settings.validator ? [{ id: "div-1", type: "divider" as const }, ...validatorBlocks(settings.validator)] : []),
              { id: "div-2", type: "divider" },
              {
                id: "confidential",
                type: "paragraph",
                text: [
                  { text: "Proyecto confidencial", bold: true },
                  { text: " — Toda la información compartida en este portal es de uso exclusivo para el proyecto." },
                ],
              },
            ]}
          />
        </article>
      </section>
    </>
  );
}
