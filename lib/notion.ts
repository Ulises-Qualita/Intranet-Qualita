// API de Notion. Solo server: usa NOTION_TOKEN (integración interna del workspace).
//
// Desde la versión 2025-09-03 una database de Notion contiene una o más *data
// sources*, y las consultas van contra el data source, no contra la database.
// Por eso acá todo se identifica con data_source_id.
import { unstable_cache } from "next/cache";
import { toTicket, type NotionConfig, type NotionTicket } from "./notion-map";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = process.env.NOTION_VERSION || "2026-03-11";

// Tag para invalidar el cache de tickets desde el botón "Actualizar".
export const NOTION_TICKETS_TAG = "notion-tickets";

// Segundos que vive la lectura de Notion. getTasks() corre en el layout, o sea en
// cada render de cada página: sin cache cada navegación pegaría a Notion.
const TICKETS_TTL = 60;

export const notionConfigured = () => Boolean(process.env.NOTION_TOKEN);

export class NotionError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

// Mensajes accionables para los dos errores que el equipo se va a comer seguido.
export function notionErrorMessage(e: unknown) {
  if (!(e instanceof NotionError)) return "No se pudo leer Notion. Probá de nuevo en unos minutos.";
  if (e.status === 401) return "El token de Notion es inválido o fue revocado. Revisá NOTION_TOKEN.";
  if (e.status === 404) {
    return "Notion no encuentra esa database. Compartila con la integración desde el menú ••• → Conexiones.";
  }
  if (e.status === 429) return "Notion está limitando las consultas. Esperá un minuto y probá de nuevo.";
  return e.message;
}

async function notionFetch<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new NotionError("Falta configurar NOTION_TOKEN en el servidor.", 0);

  const res = await fetch(`${NOTION_API}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new NotionError(body?.message ?? `Notion respondió ${res.status}`, res.status, body?.code);
  }
  return body as T;
}

// ---------- Tipos de la API ----------

type Paginated<T> = { results: T[]; has_more: boolean; next_cursor: string | null };

export type NotionProperty = {
  id: string;
  name: string;
  type: string;
  // Presentes según el tipo; se usan para armar la UI de mapeo.
  options?: { id: string; name: string; color?: string }[];
  groups?: { id: string; name: string; option_ids: string[] }[];
};

export type NotionDataSource = {
  id: string;
  name: string;
  properties: NotionProperty[];
};

export type NotionPageRef = { id: string; title: string };

// Página cruda tal como la devuelve el query; el mapeo vive en lib/notion-map.ts.
export type NotionPage = {
  id: string;
  url: string;
  // Presente solo si la página está publicada en la web ("Compartir en la web").
  public_url?: string | null;
  properties: Record<string, RawProperty>;
};

export type RawProperty = {
  type: string;
  title?: { plain_text: string }[];
  rich_text?: { plain_text: string }[];
  status?: { name: string } | null;
  select?: { name: string } | null;
  multi_select?: { name: string }[];
  date?: { start: string | null; end?: string | null } | null;
  people?: { id: string; name?: string; person?: { email?: string } }[];
  relation?: { id: string }[];
  checkbox?: boolean;
  formula?: { type: string; string?: string | null; date?: { start: string | null } | null };
};

const plainText = (parts?: { plain_text: string }[]) => (parts ?? []).map((p) => p.plain_text).join("").trim();

// El título de una página es la única propiedad de tipo "title".
export function pageTitle(page: NotionPage) {
  for (const prop of Object.values(page.properties)) {
    if (prop.type === "title") return plainText(prop.title) || "Sin título";
  }
  return "Sin título";
}

// ---------- Data sources ----------

type RawDataSource = {
  id: string;
  name?: string;
  title?: { plain_text: string }[];
  properties?: Record<string, { id: string; type: string; [k: string]: unknown }>;
};

const toProperties = (raw: RawDataSource["properties"]): NotionProperty[] =>
  Object.entries(raw ?? {})
    .map(([name, prop]) => {
      const config = prop[prop.type] as { options?: NotionProperty["options"]; groups?: NotionProperty["groups"] } | undefined;
      return { id: prop.id, name, type: prop.type, options: config?.options, groups: config?.groups };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "es"));

// Data sources que el token puede ver. Notion solo devuelve lo que fue compartido
// explícitamente con la integración.
export async function searchDataSources(): Promise<NotionDataSource[]> {
  const found: RawDataSource[] = [];
  let cursor: string | null = null;

  // Tope de páginas por las dudas; un workspace normal entra en la primera.
  for (let i = 0; i < 10; i++) {
    const page: Paginated<RawDataSource> = await notionFetch("/search", {
      method: "POST",
      body: {
        filter: { property: "object", value: "data_source" },
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      },
    });
    found.push(...page.results);
    if (!page.has_more || !page.next_cursor) break;
    cursor = page.next_cursor;
  }

  return found
    .map((ds) => ({
      id: ds.id,
      name: ds.name || plainText(ds.title) || "Sin nombre",
      properties: toProperties(ds.properties),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

// Schema completo de un data source, para la pantalla de mapeo.
export async function getDataSource(id: string): Promise<NotionDataSource> {
  const ds = await notionFetch<RawDataSource>(`/data_sources/${id}`);
  return {
    id: ds.id,
    name: ds.name || plainText(ds.title) || "Sin nombre",
    properties: toProperties(ds.properties),
  };
}

// ---------- Consultas ----------

async function queryAll(dataSourceId: string, body: Record<string, unknown> = {}): Promise<NotionPage[]> {
  const pages: NotionPage[] = [];
  let cursor: string | null = null;

  // Notion pagina de a 100. El tope de 50 vueltas (5.000 tickets) evita que un
  // error de paginación deje la request colgada para siempre.
  for (let i = 0; i < 50; i++) {
    const page: Paginated<NotionPage> = await notionFetch(`/data_sources/${dataSourceId}/query`, {
      method: "POST",
      body: { page_size: 100, ...body, ...(cursor ? { start_cursor: cursor } : {}) },
    });
    pages.push(...page.results);
    if (!page.has_more || !page.next_cursor) break;
    cursor = page.next_cursor;
  }
  return pages;
}

// Proyectos (id + título) para el selector de cada cliente.
export async function listProjects(dataSourceId: string): Promise<NotionPageRef[]> {
  const pages = await queryAll(dataSourceId);
  return pages
    .map((p) => ({ id: p.id, title: pageTitle(p) }))
    .sort((a, b) => a.title.localeCompare(b.title, "es"));
}

export async function getPageRef(pageId: string): Promise<NotionPageRef> {
  const page = await notionFetch<NotionPage>(`/pages/${pageId}`);
  return { id: page.id, title: pageTitle(page) };
}

// Todos los tickets del estudio en una sola consulta (la DB de Tickets es única,
// así que esto alimenta a toda la app sin hacer una llamada por cliente).
//
// Es lo ÚNICO que se cachea: depende solo del token de env y de la config, nunca
// de la sesión. El mapeo ticket → cliente y ticket → responsable se hace fuera,
// por request, porque necesita la sesión (unstable_cache no admite cookies()).
//
// La traducción a NotionTicket va ADENTRO del cache a propósito: las páginas
// crudas de Notion pesan varios MB (traen cada propiedad, rich text y formato) y
// el data cache de Next descarta cualquier entrada de más de 2 MB en silencio, con
// lo cual no se cacheaba nada y cada render volvía a pegarle a Notion.
export const getTickets = unstable_cache(
  async (config: NotionConfig): Promise<NotionTicket[]> =>
    (await queryAll(config.ticketsDataSourceId))
      .map((page) => toTicket(page, config))
      // Los estados marcados como "No mostrar" (reuniones y demás) quedan afuera acá,
      // así no llegan ni al tablero ni a los contadores de tareas pendientes.
      .filter((t) => !t.hidden),
  ["notion-tickets"],
  { revalidate: TICKETS_TTL, tags: [NOTION_TICKETS_TAG] },
);
