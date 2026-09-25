// API de Notion. Solo server: usa NOTION_TOKEN (integración interna del workspace).
//
// Desde la versión 2025-09-03 una database de Notion contiene una o más *data
// sources*, y las consultas van contra el data source, no contra la database.
// Por eso acá todo se identifica con data_source_id.
import { unstable_cache } from "next/cache";
import {
  TRANSPARENT_TYPES,
  toBlockNode,
  toEmbeddedDb,
  type BlockNode,
  type EmbeddedDb,
  type RawBlock,
  type RawSchemaProp,
  type RawView,
} from "./notion-blocks";
import { pageIdFromUrl, toTicket, type NotionConfig, type NotionTicket } from "./notion-map";

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
  cover?: NotionFile | null;
  icon?: (NotionFile & { emoji?: string }) | null;
};

// Archivos de Notion: subidos (url firmada que vence en 1 h) o externos.
type NotionFile = { type?: string; file?: { url?: string }; external?: { url?: string } };

export const notionFileUrl = (f?: NotionFile | null): string | null => f?.file?.url ?? f?.external?.url ?? null;

export type RawProperty = {
  type: string;
  title?: { plain_text: string }[];
  rich_text?: { plain_text: string }[];
  status?: { name: string } | null;
  select?: { name: string } | null;
  multi_select?: { name: string }[];
  date?: { start: string | null } | null;
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

// ---------- Portal del cliente ----------

export const NOTION_PORTAL_TAG = "notion-portal";
const PORTAL_TTL = 300;

// Profundidad y cantidad de bloques máximas. Cada nivel es una request y Notion
// limita a ~3 req/s: sin tope, una página muy anidada colgaría el render.
const MAX_DEPTH = 4;
const MAX_BLOCKS = 500;
// Cada database embebida son 2 requests más (schema + filas), y Notion limita a
// ~3 req/s: se acotan tanto la cantidad como las filas de cada una.
const MAX_DBS = 4;
const MAX_DB_ROWS = 100;
// Solapas por database: cada una es un request, y más de esto no se usa.
const MAX_DB_VIEWS = 8;

// El proyecto guarda el link al portal en una propiedad de tipo url; de ahí sale
// el id de la página que hay que leer.
async function portalPageId(config: NotionConfig, projectPageId: string): Promise<string | null> {
  const page = await notionFetch<NotionPage>(`/pages/${projectPageId}`);
  const prop = page.properties?.[config.portalUrlProp] as { url?: string | null } | undefined;
  return prop?.url ? pageIdFromUrl(prop.url) : null;
}

// Hijos de un bloque, paginados.
async function blockChildren(blockId: string): Promise<RawBlock[]> {
  const out: RawBlock[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 10; i++) {
    const qs = `page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`;
    const page: Paginated<RawBlock> = await notionFetch(`/blocks/${blockId}/children?${qs}`);
    out.push(...page.results);
    if (!page.has_more || !page.next_cursor) break;
    cursor = page.next_cursor;
  }
  return out;
}

// Árbol de bloques ya normalizado. Los bloques "transparentes" (las pestañas de
// página, los synced blocks) se atraviesan: aportan estructura de Notion, no
// contenido, así que se usan sus hijos en su lugar.
// El id del bloque child_database es el id de la database. Se resuelve a filas;
// devuelve null si es una vista enlazada (sin data sources propias, Notion no
// expone a qué database apunta).
async function fetchEmbeddedDb(databaseId: string): Promise<EmbeddedDb | null> {
  try {
    const db = await notionFetch<{ data_sources?: { id: string }[] }>(`/databases/${databaseId}`);
    const sourceId = db.data_sources?.[0]?.id;
    if (!sourceId) return null;

    const [pages, meta] = await Promise.all([
      queryAll(sourceId, { page_size: MAX_DB_ROWS }),
      fetchDbMeta(databaseId, sourceId),
    ]);
    return toEmbeddedDb(pages.slice(0, MAX_DB_ROWS) as unknown as Parameters<typeof toEmbeddedDb>[0], meta);
  } catch (e) {
    console.error("[notion] fetchEmbeddedDb", databaseId, e);
    return null;
  }
}

// Vistas de la database (las solapas "Calendario", "Etapas"… de Notion) y el
// schema del data source, que trae el orden y color de las opciones para los
// grupos del tablero. El listado de vistas solo trae ids: cada una se pide aparte.
// Es un extra: si falla, la database se dibuja igual con una vista por defecto.
async function fetchDbMeta(
  databaseId: string,
  sourceId: string,
): Promise<{ views: RawView[]; schema: RawSchemaProp[] } | null> {
  try {
    const [ds, list] = await Promise.all([
      notionFetch<RawDataSource>(`/data_sources/${sourceId}`),
      notionFetch<Paginated<{ id: string }>>(`/views?database_id=${databaseId}&page_size=${MAX_DB_VIEWS}`),
    ]);
    const views = await Promise.all(
      list.results.slice(0, MAX_DB_VIEWS).map((v) => notionFetch<RawView & { data_source_id?: string | null }>(`/views/${v.id}`)),
    );
    return {
      // Una database con varias fuentes tiene vistas de cada una; acá solo se leyó la primera.
      views: views.filter((v) => !v.data_source_id || v.data_source_id === sourceId),
      schema: toProperties(ds.properties),
    };
  } catch (e) {
    console.error("[notion] fetchDbMeta", databaseId, e);
    return null;
  }
}

async function fetchBlockTree(
  rootId: string,
  budget: { left: number },
  depth = 0,
  dbs: { left: number } = { left: MAX_DBS },
): Promise<BlockNode[]> {
  if (depth > MAX_DEPTH || budget.left <= 0) return [];

  const raw = await blockChildren(rootId);
  const nodes: BlockNode[] = [];

  for (const block of raw) {
    if (budget.left <= 0) break;

    if (TRANSPARENT_TYPES.has(block.type)) {
      if (block.has_children) nodes.push(...(await fetchBlockTree(block.id, budget, depth)));
      continue;
    }

    budget.left--;
    const node = toBlockNode(block);

    // Una database embebida (el roadmap del portal) se resuelve aparte: sus filas
    // no son bloques hijos, hay que consultarla.
    if (node.type === "child_database") {
      node.db = dbs.left > 0 ? ((dbs.left--, await fetchEmbeddedDb(block.id)) ?? null) : null;
      nodes.push(node);
      continue;
    }

    // child_page no se expande: es un link a otra página, no contenido de esta.
    if (block.has_children && node.type !== "child_page") {
      node.children = await fetchBlockTree(block.id, budget, depth + 1, dbs);
    }
    nodes.push(node);
  }
  return nodes;
}

// missing = el proyecto no tiene el link cargado; unreachable = está cargado pero
// la integración no tiene acceso a esa página. Se distinguen porque la salida para
// el usuario es distinta: cargar el link vs. compartir la página.
export type PortalIcon = { kind: "emoji"; emoji: string } | { kind: "image"; url: string };

export type Portal =
  | {
      state: "ok";
      title: string;
      url: string;
      cover: string | null;
      icon: PortalIcon | null;
      blocks: BlockNode[];
    }
  | { state: "missing" }
  | { state: "unreachable"; pageId: string };

// Portal de un proyecto, listo para renderizar con el render propio de bloques.
//
// Igual que con los tickets, la normalización va ADENTRO del cache: los bloques
// crudos de Notion pesan de más y el data cache de Next descarta en silencio
// cualquier entrada de más de 2 MB.
export const getPortal = unstable_cache(
  async (config: NotionConfig, projectPageId: string): Promise<Portal> => {
    const pageId = await portalPageId(config, projectPageId);
    if (!pageId) return { state: "missing" };

    // La página del portal puede estar fuera de lo compartido con la integración:
    // ahí Notion responde 404 y hay que pedirle al usuario que la comparta.
    let page: NotionPage;
    try {
      page = await notionFetch<NotionPage>(`/pages/${pageId}`);
    } catch (e) {
      if (e instanceof NotionError && e.status === 404) return { state: "unreachable", pageId };
      throw e;
    }

    const blocks = await fetchBlockTree(page.id, { left: MAX_BLOCKS });

    // Las urls de archivo de Notion vienen firmadas y vencen en 1 h; el cache del
    // portal dura 5 min, así que nunca se sirve una vencida.
    const iconUrl = notionFileUrl(page.icon);
    const icon: PortalIcon | null = page.icon?.emoji
      ? { kind: "emoji", emoji: page.icon.emoji }
      : iconUrl
        ? { kind: "image", url: iconUrl }
        : null;

    return { state: "ok", title: pageTitle(page), url: page.url, cover: notionFileUrl(page.cover), icon, blocks };
  },
  ["notion-portal"],
  { revalidate: PORTAL_TTL, tags: [NOTION_PORTAL_TAG] },
);
