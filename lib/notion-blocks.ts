// Bloques de Notion → árbol chico y propio, listo para renderizar.
// Puro, sin I/O: lo usan tanto la capa de server como el componente de render.
//
// La normalización existe por dos razones: los bloques crudos de Notion son enormes
// (cada rich_text trae anotaciones, colores y hrefs completos) y el data cache de
// Next descarta en silencio lo que pase de 2 MB; y el render no tiene por qué
// conocer la forma de la API.

export type RichText = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  href?: string | null;
};

export type BlockType =
  | "paragraph"
  | "heading_1"
  | "heading_2"
  | "heading_3"
  | "bulleted_list_item"
  | "numbered_list_item"
  | "to_do"
  | "toggle"
  | "quote"
  | "callout"
  | "code"
  | "divider"
  | "image"
  | "video"
  | "bookmark"
  | "embed"
  | "file"
  | "column_list"
  | "column"
  | "table"
  | "table_row"
  | "child_page"
  | "child_database"
  | "unsupported";

// Una database embebida en la página (p. ej. el roadmap del portal) se muestra
// como tabla. Las celdas van tipadas para poder dibujar chips y fechas.
// El color viene de la opción en Notion, para que los chips se vean igual acá.
export type Tag = { name: string; color: string };

export type DbCell =
  | { kind: "text"; text: string }
  // end: fin de un rango de Notion (inicio → fin); sin rango, no viene.
  | { kind: "date"; text: string; end?: string }
  | { kind: "tags"; tags: Tag[] }
  | { kind: "check"; checked: boolean };

export type DbRow = { id: string; cells: DbCell[] };

// Una vista de la database como está armada en Notion (las solapas de arriba:
// "Calendario", "Etapas"…). Las propiedades ya vienen traducidas a índices de
// columna. Se dibujan estos tres tipos; el resto (galería, lista…) cae en tabla.
export type DbView = {
  id: string;
  name: string;
  kind: "calendar" | "board" | "table";
  // calendar: qué columna de fecha ubica cada fila.
  dateColumn?: number;
  // board: columna que agrupa, grupos en el orden de Notion y qué propiedades
  // muestra cada tarjeta además del título.
  groupColumn?: number;
  groups?: Tag[];
  hideEmptyGroups?: boolean;
  cardColumns?: number[];
  // table: columnas visibles en el orden de la vista (sin esto, todas).
  tableColumns?: number[];
};

export type EmbeddedDb = {
  columns: string[];
  rows: DbRow[];
  // Índices de la columna de título y de la de fecha (si hay). Con fecha, la
  // database se puede dibujar como calendario.
  titleColumn: number;
  dateColumn: number | null;
  // Nunca vacío: si Notion no devuelve las vistas, se arma una por defecto
  // (calendario si hay fecha, si no tabla).
  views: DbView[];
  // Eventos que no son filas de Notion: las reuniones de Google Calendar en el
  // portal. Las muestra la vista calendario, mezcladas con las filas, y además
  // la solapa "Reuniones", que las tiene solas. No vienen de Notion: los suma
  // withExtraEvents después de leer la página, fuera del cache.
  extraEvents?: ExtraEvent[];
};

// Lo mínimo que se usa de la API de vistas y del schema del data source.
export type RawView = {
  id: string;
  name?: string;
  type: string;
  configuration?: {
    date_property_id?: string;
    group_by?: { property_id?: string; hide_empty_groups?: boolean };
    properties?: { property_id: string; visible?: boolean }[];
  };
};
export type RawSchemaProp = { id: string; type: string; options?: { name: string; color?: string }[] };

export type BlockNode = {
  id: string;
  type: BlockType;
  text?: RichText[];
  children?: BlockNode[];
  url?: string;
  caption?: RichText[];
  checked?: boolean;
  language?: string;
  icon?: string | null;
  // Filas de tabla: cada celda es su propio rich text.
  cells?: RichText[][];
  hasHeaderRow?: boolean;
  // child_database: contenido resuelto, o null si es una vista enlazada (Notion
  // no expone a qué database apunta).
  db?: EmbeddedDb | null;
  // Solo para "unsupported": qué tipo era, para avisarlo en la UI interna.
  rawType?: string;
};

const KNOWN = new Set<string>([
  "paragraph",
  "heading_1",
  "heading_2",
  "heading_3",
  "bulleted_list_item",
  "numbered_list_item",
  "to_do",
  "toggle",
  "quote",
  "callout",
  "code",
  "divider",
  "image",
  "video",
  "bookmark",
  "embed",
  "file",
  "column_list",
  "column",
  "table",
  "table_row",
  "child_page",
  "child_database",
]);

// Bloques que solo agrupan y no aportan nada al render: se atraviesan y se usan
// sus hijos en su lugar. "tab" son las pestañas de página de Notion.
export const TRANSPARENT_TYPES = new Set(["tab", "synced_block", "template"]);

type RawRich = {
  plain_text?: string;
  href?: string | null;
  annotations?: { bold?: boolean; italic?: boolean; underline?: boolean; strikethrough?: boolean; code?: boolean };
};

export type RawBlock = {
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
};

function toRichText(parts?: RawRich[]): RichText[] {
  return (parts ?? [])
    .map((p) => {
      const a = p.annotations ?? {};
      const node: RichText = { text: p.plain_text ?? "" };
      // Solo se guardan las marcas activas: el objeto viaja al cache y al cliente.
      if (a.bold) node.bold = true;
      if (a.italic) node.italic = true;
      if (a.underline) node.underline = true;
      if (a.strikethrough) node.strike = true;
      if (a.code) node.code = true;
      if (p.href) node.href = p.href;
      return node;
    })
    .filter((n) => n.text !== "");
}

// Los archivos de Notion vienen como {type:"file", file:{url}} (URL firmada que
// vence) o {type:"external", external:{url}}.
function fileUrl(value: unknown): string | undefined {
  const v = value as { type?: string; file?: { url?: string }; external?: { url?: string } } | undefined;
  return v?.file?.url ?? v?.external?.url;
}

const iconOf = (value: unknown): string | null => {
  const v = value as { type?: string; emoji?: string } | undefined;
  return v?.emoji ?? null;
};

export function toBlockNode(raw: RawBlock): BlockNode {
  const type = raw.type;
  const body = raw[type] as Record<string, unknown> | undefined;
  const node: BlockNode = { id: raw.id, type: "unsupported" };

  if (!KNOWN.has(type)) return { ...node, rawType: type };
  node.type = type as BlockType;

  const rich = body?.rich_text as RawRich[] | undefined;
  if (rich) node.text = toRichText(rich);

  switch (type) {
    case "to_do":
      node.checked = Boolean(body?.checked);
      break;
    case "callout":
      node.icon = iconOf(body?.icon);
      break;
    case "code":
      node.language = (body?.language as string) ?? "";
      break;
    case "image":
    case "video":
    case "file":
      node.url = fileUrl(body);
      node.caption = toRichText(body?.caption as RawRich[] | undefined);
      break;
    case "bookmark":
    case "embed":
      node.url = body?.url as string | undefined;
      node.caption = toRichText(body?.caption as RawRich[] | undefined);
      break;
    case "table":
      node.hasHeaderRow = Boolean(body?.has_column_header);
      break;
    case "table_row":
      node.cells = ((body?.cells as RawRich[][]) ?? []).map(toRichText);
      break;
    case "child_page":
    case "child_database":
      node.text = [{ text: (body?.title as string) || "Sin título" }];
      break;
  }

  return node;
}

// Notion entrega los ítems de lista planos, uno por bloque. Para renderizar <ul>/<ol>
// hay que juntar los consecutivos del mismo tipo.
export type BlockGroup =
  | { kind: "list"; type: "bulleted_list_item" | "numbered_list_item"; items: BlockNode[] }
  | { kind: "block"; node: BlockNode };

export function groupBlocks(nodes: BlockNode[]): BlockGroup[] {
  const groups: BlockGroup[] = [];
  for (const node of nodes) {
    if (node.type === "bulleted_list_item" || node.type === "numbered_list_item") {
      const last = groups[groups.length - 1];
      if (last?.kind === "list" && last.type === node.type) {
        last.items.push(node);
        continue;
      }
      groups.push({ kind: "list", type: node.type, items: [node] });
      continue;
    }
    groups.push({ kind: "block", node });
  }
  return groups;
}

export const plainOf = (text?: RichText[]) => (text ?? []).map((t) => t.text).join("");

// ---------- Databases embebidas ----------

// Propiedades que no se muestran en el portal: las relaciones apuntan a páginas
// internas (tickets) que el cliente no debería ver, y los ids no dicen nada.
const HIDDEN_DB_TYPES = new Set(["relation", "rollup", "created_by", "last_edited_by", "button", "unique_id"]);

type RawDbProp = Record<string, unknown> & { type: string };
type NotionDate = { start?: string | null; end?: string | null };

// Fecha de Notion, con el fin si es un rango (y solo si cae después del inicio).
function dateCell(date: NotionDate | null): DbCell {
  const start = (date?.start ?? "").slice(0, 10);
  const end = (date?.end ?? "").slice(0, 10);
  return start && end > start ? { kind: "date", text: start, end } : { kind: "date", text: start };
}

export function toDbCell(prop: RawDbProp): DbCell {
  const p = prop as Record<string, never> & RawDbProp;
  switch (prop.type) {
    case "title":
      return { kind: "text", text: plainOf(toRichText(p.title)) };
    case "rich_text":
      return { kind: "text", text: plainOf(toRichText(p.rich_text)) };
    case "select":
    case "status": {
      const o = p[prop.type] as Tag | null;
      return { kind: "tags", tags: o ? [{ name: o.name, color: o.color ?? "default" }] : [] };
    }
    case "multi_select":
      return {
        kind: "tags",
        tags: ((p.multi_select ?? []) as Tag[]).map((o) => ({ name: o.name, color: o.color ?? "default" })),
      };
    case "date":
      return dateCell(p.date as NotionDate | null);
    case "checkbox":
      return { kind: "check", checked: Boolean(p.checkbox) };
    case "number":
      return { kind: "text", text: p.number == null ? "" : String(p.number) };
    case "people":
      return {
        kind: "tags",
        tags: ((p.people ?? []) as { name?: string }[])
          .filter((o) => o.name)
          .map((o) => ({ name: o.name!, color: "default" })),
      };
    case "url":
    case "email":
    case "phone_number":
      return { kind: "text", text: (p[prop.type] as string) ?? "" };
    case "formula": {
      const f = p.formula as { type: string; string?: string; number?: number; date?: NotionDate } | undefined;
      if (f?.type === "date") return dateCell(f.date ?? null);
      if (f?.type === "number") return { kind: "text", text: f.number == null ? "" : String(f.number) };
      return { kind: "text", text: f?.string ?? "" };
    }
    default:
      return { kind: "text", text: "" };
  }
}

// Notion a veces manda los ids de propiedad url-encodeados y a veces no.
const propKey = (id: string) => {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
};

// Vistas no dibujables acá: no muestran filas (formulario, gráfico) o necesitan
// otra cosa (mapa, dashboard de widgets). Se omiten en vez de caer en tabla.
const SKIPPED_VIEWS = new Set(["form", "chart", "map", "dashboard"]);

// Filas crudas de una database → tabla lista para renderizar. El título va
// primero: es la columna que identifica cada fila. `meta` trae las vistas y el
// schema; sin eso (o si Notion no los dio) se arma una vista por defecto.
export function toEmbeddedDb(
  pages: { id: string; properties: Record<string, RawDbProp> }[],
  meta?: { views: RawView[]; schema: RawSchemaProp[] } | null,
): EmbeddedDb {
  const first = pages[0];
  if (!first) return { columns: [], rows: [], titleColumn: 0, dateColumn: null, views: [] };

  const names = Object.keys(first.properties).filter((n) => !HIDDEN_DB_TYPES.has(first.properties[n].type));
  const titleName = names.find((n) => first.properties[n].type === "title");
  const columns = titleName ? [titleName, ...names.filter((n) => n !== titleName)] : names;

  const rows = pages.map((page) => ({
    id: page.id,
    cells: columns.map((n) => toDbCell(page.properties[n] ?? ({ type: "rich_text" } as RawDbProp))),
  }));

  // Notion no expone el orden de la vista embebida, así que cualquier orden es una
  // suposición. Por fecha ascendente es la más útil para un roadmap y la que más
  // se parece a cómo lo lee un cliente.
  const dateCol = columns.findIndex((_, i) => rows.every((r) => r.cells[i].kind === "date"));
  if (dateCol >= 0) {
    rows.sort((a, b) => {
      const av = (a.cells[dateCol] as { text: string }).text;
      const bv = (b.cells[dateCol] as { text: string }).text;
      if (!av) return bv ? 1 : 0;
      if (!bv) return -1;
      return av.localeCompare(bv);
    });
  }

  const titleColumn = titleName ? 0 : -1;
  const dateColumn = dateCol >= 0 ? dateCol : null;

  const colById = new Map(columns.map((n, i) => [propKey(String(first.properties[n].id ?? "")), i]));
  const col = (id?: string) => (id ? colById.get(propKey(id)) : undefined);
  const isDateCol = (c: number) => rows.every((r) => r.cells[c].kind === "date");

  const views: DbView[] = [];
  for (const v of meta?.views ?? []) {
    if (SKIPPED_VIEWS.has(v.type)) continue;
    const conf = v.configuration ?? {};

    // La línea de tiempo se dibuja como calendario: es lo más parecido que hay acá.
    if (v.type === "calendar" || v.type === "timeline") {
      const c = col(conf.date_property_id);
      if (c !== undefined && isDateCol(c)) {
        views.push({ id: v.id, name: v.name?.trim() || "Calendario", kind: "calendar", dateColumn: c });
        continue;
      }
    }

    if (v.type === "board") {
      const groupId = conf.group_by?.property_id;
      const c = col(groupId);
      if (c !== undefined && c !== titleColumn) {
        // Grupos en el orden de las opciones en Notion. Si la propiedad no tiene
        // opciones (personas, texto), en el orden en que aparecen en las filas.
        const options = meta?.schema.find((p) => propKey(p.id) === propKey(groupId!))?.options;
        const groups: Tag[] = options?.length
          ? options.map((o) => ({ name: o.name, color: o.color ?? "default" }))
          : [];
        if (!groups.length) {
          for (const r of rows) {
            const cell = r.cells[c];
            const names = cell.kind === "tags" ? cell.tags : "text" in cell && cell.text ? [{ name: cell.text, color: "default" }] : [];
            for (const t of names) if (!groups.some((g) => g.name === t.name)) groups.push(t);
          }
        }
        const cardColumns = (conf.properties ?? [])
          .filter((p) => p.visible !== false)
          .map((p) => col(p.property_id))
          .filter((i): i is number => i !== undefined && i !== c && i !== titleColumn);

        views.push({
          id: v.id,
          name: v.name?.trim() || "Tablero",
          kind: "board",
          groupColumn: c,
          groups,
          hideEmptyGroups: Boolean(conf.group_by?.hide_empty_groups),
          cardColumns,
        });
        continue;
      }
    }

    // Tabla (y lo que no se pudo dibujar de otra forma): las columnas que la vista
    // tiene visibles, en su orden. Las relaciones ocultas acá ya no están en `col`.
    const visible = (conf.properties ?? [])
      .filter((p) => p.visible !== false)
      .map((p) => col(p.property_id))
      .filter((i): i is number => i !== undefined);
    views.push({
      id: v.id,
      name: v.name?.trim() || "Tabla",
      kind: "table",
      tableColumns: visible.length ? visible : undefined,
    });
  }

  if (!views.length) {
    views.push(
      dateColumn !== null
        ? { id: "default", name: "Calendario", kind: "calendar", dateColumn }
        : { id: "default", name: "Tabla", kind: "table" },
    );
  }

  return { columns, rows, titleColumn, dateColumn, views };
}

// ---------- Tablero ----------

export type BoardColumn = { key: string; tag: Tag | null; label: string; rows: DbRow[] };

// Filas repartidas en los grupos de la vista. Una multi-selección cae en cada una
// de sus opciones (como en Notion) y las filas sin valor van a "Sin <propiedad>",
// al principio, que es donde Notion pone ese grupo.
export function buildBoard(db: EmbeddedDb, view: DbView): BoardColumn[] {
  const c = view.groupColumn;
  if (c === undefined) return [];

  const byName = new Map<string, DbRow[]>();
  const empty: DbRow[] = [];
  for (const row of db.rows) {
    const cell = row.cells[c];
    const names = cell.kind === "tags" ? cell.tags.map((t) => t.name) : "text" in cell && cell.text ? [cell.text] : [];
    if (!names.length) empty.push(row);
    for (const n of names) byName.set(n, [...(byName.get(n) ?? []), row]);
  }

  const columns: BoardColumn[] = [
    { key: "__empty", tag: null, label: `Sin ${db.columns[c].toLowerCase()}`, rows: empty },
    ...(view.groups ?? []).map((t) => ({ key: t.name, tag: t, label: t.name, rows: byName.get(t.name) ?? [] })),
  ];
  // El grupo "Sin…" solo aparece si tiene algo; el resto respeta la vista.
  return columns.filter((col) => (col.tag === null || view.hideEmptyGroups ? col.rows.length > 0 : true));
}

// ---------- Calendario ----------

export type CalEvent = {
  id: string;
  title: string;
  color: string;
  // Lo que muestra el detalle al tocar el evento: las propiedades de la fila de
  // Notion (o horario y participantes de una reunión), ya en texto.
  details: { label: string; value: string }[];
  // Segunda línea del evento en el calendario: el "Entregable" de la tarea como
  // badges de color (Desarrollo, Manual de marca…), o un texto (el horario de una
  // reunión, o un Entregable que en Notion es texto y no una opción).
  badges?: Tag[];
  subtitle?: string;
  // Solo en los eventos extra (reuniones): hora de inicio, el link para entrar si
  // todavía no pasó, y la descripción que escribe el equipo si ya pasó.
  kind?: "meeting";
  time?: string;
  href?: string | null;
  notes?: string | null;
  // Reunión que ya pasó (se dibuja apagada).
  done?: boolean;
};
export type ExtraEvent = CalEvent & { day: string };

// Suma `events` a todas las databases con calendario de la página, sin tocar
// sus filas: se ven en el calendario y en la solapa "Reuniones" de esa database
// (la tabla y el tablero no los muestran). Devuelve una copia.
export function withExtraEvents(nodes: BlockNode[], events: ExtraEvent[]): BlockNode[] {
  if (!events.length) return nodes;
  return nodes.map((node) => {
    const db = node.db && node.db.views.some((v) => v.kind === "calendar") ? { ...node.db, extraEvents: events } : node.db;
    const children = node.children ? withExtraEvents(node.children, events) : node.children;
    return db === node.db && children === node.children ? node : { ...node, db, children };
  });
}
// Un evento dentro de una semana: una sola barra de `span` días desde la columna
// `col` (0 = lunes), en su carril. Un rango que cruza de semana es una barra por
// semana; `fromPrev` / `toNext` dicen si viene de la anterior o sigue en la próxima.
export type CalBar = {
  event: CalEvent;
  // Rango completo del evento (para el detalle).
  start: string;
  end: string;
  col: number;
  span: number;
  lane: number;
  fromPrev: boolean;
  toNext: boolean;
};
export type CalDay = { iso: string; day: number; inMonth: boolean; isToday: boolean };
// `lanes`: carriles que usa la semana (el alto de la fila depende de eso).
export type CalWeek = { days: CalDay[]; bars: CalBar[]; lanes: number };
export type CalMonth = { key: string; label: string; weeks: CalWeek[] };

const MS_DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

const dayFmt = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

// Nombre de columna comparable: sin mayúsculas, tildes ni espacios de más.
const normalizeLabel = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

// Colores para los entregables que en Notion no tienen color: se reparten en
// orden de aparición dentro del calendario, así dos entregables distintos no
// comparten color hasta agotar la paleta, y cada uno conserva el suyo en todo el mes.
const BADGE_COLORS = ["blue", "green", "orange", "purple", "pink", "yellow", "red", "brown"];

const hasOwnColor = (tag: Tag) => Boolean(tag.color) && tag.color !== "default" && tag.color !== "gray";

// `taken`: colores que ya usan en Notion otras opciones de la misma columna;
// se usan últimos, así un entregable sin color no se confunde con uno que sí tiene.
function badgePalette(taken: Set<string>) {
  const order = [...BADGE_COLORS.filter((c) => !taken.has(c)), ...BADGE_COLORS.filter((c) => taken.has(c))];
  const assigned = new Map<string, string>();
  return (tag: Tag) => {
    if (hasOwnColor(tag)) return tag.color;
    if (!assigned.has(tag.name)) assigned.set(tag.name, order[assigned.size % order.length]);
    return assigned.get(tag.name)!;
  };
}

// El Entregable de una fila: badges si es una opción de Notion, texto si no.
function deliverableOf(cell: DbCell | undefined, color: (tag: Tag) => string): Pick<CalEvent, "badges" | "subtitle"> {
  if (!cell) return {};
  if (cell.kind === "tags") return { badges: cell.tags.map((t) => ({ name: t.name, color: color(t) })) };
  return { subtitle: cellText(cell) || undefined };
}

// Una celda en texto para el detalle del evento; "" si está vacía.
function cellText(cell: DbCell | undefined): string {
  if (!cell) return "";
  switch (cell.kind) {
    case "tags":
      return cell.tags.map((t) => t.name).join(", ");
    case "date": {
      if (!cell.text) return "";
      const day = (d: string) => dayFmt.format(new Date(`${d}T12:00:00Z`));
      return cell.end ? `${day(cell.text)} → ${day(cell.end)}` : day(cell.text);
    }
    case "check":
      return cell.checked ? "Sí" : "No";
    default:
      return cell.text;
  }
}

// Propiedades de una fila con valor, en el orden de las columnas (sin `skip`).
function rowDetails(db: EmbeddedDb, row: DbRow, skip: number[]) {
  return db.columns
    .map((label, i) => ({ label, value: skip.includes(i) ? "" : cellText(row.cells[i]) }))
    .filter((d) => d.value);
}

// El color del chip sale de la primera etiqueta de la fila que tenga color, así
// el calendario hereda la paleta que ya usás en Notion.
function eventColor(row: DbRow, skip: number[]): string {
  for (let i = 0; i < row.cells.length; i++) {
    if (skip.includes(i)) continue;
    const cell = row.cells[i];
    if (cell.kind === "tags" && cell.tags[0]?.color && cell.tags[0].color !== "default") return cell.tags[0].color;
  }
  return "default";
}

// Ubica los tramos que tocan esta semana, cada uno en el primer carril libre en
// todos sus días (los tramos llegan ordenados por inicio). Así una barra de varios
// días queda a la misma altura de punta a punta, como en Notion.
function placeWeek(days: CalDay[], spans: { event: CalEvent; start: string; end: string }[]): CalWeek {
  const first = days[0].iso;
  const last = days[days.length - 1].iso;
  const bars: CalBar[] = [];
  // Por carril, el último día (índice en la semana) que ya está ocupado.
  const busyUntil: number[] = [];
  for (const s of spans) {
    if (s.start > last || s.end < first) continue;
    const from = days.findIndex((d) => d.iso >= s.start);
    const to = days.findLastIndex((d) => d.iso <= s.end);
    let lane = busyUntil.findIndex((until) => until < from);
    if (lane < 0) lane = busyUntil.length;
    busyUntil[lane] = to;
    bars.push({
      event: s.event,
      start: s.start,
      end: s.end,
      col: from,
      span: to - from + 1,
      lane,
      fromPrev: s.start < first,
      toNext: s.end > last,
    });
  }
  return { days, bars, lanes: busyUntil.length };
}

// Meses corridos del primero al último que tienen filas (uno vacío en el medio se
// muestra igual, así pasar de mes avanza de a uno como en Notion), cada uno con su
// grilla de semanas de lunes a domingo. `initial` es el mes en el que abre la
// vista: el actual si cae en el rango, si no el extremo más cercano.
// Las filas sin fecha no aparecen, igual que en el calendario de Notion (en el
// tablero sí están). `today` se pasa desde afuera para no congelarlo en el cache.
// `source`: "all" arma el calendario de Notion (las filas de la database más
// las reuniones); "extra", el de la solapa Reuniones (solo `extraEvents`;
// `dateColumn` no se usa).
export function buildCalendar(
  db: EmbeddedDb,
  dateColumn: number,
  today: string,
  source: "all" | "extra" = "all",
): { months: CalMonth[]; initial: number; twoLines: boolean } {
  // La propiedad "Entregable(s)" va como segunda línea de cada evento, si existe.
  const deliverable = db.columns.findIndex((c) => /^entregables?$/.test(normalizeLabel(c)));
  const badgeColor = badgePalette(
    new Set(
      db.rows.flatMap((r) => {
        const cell = r.cells[deliverable];
        return cell?.kind === "tags" ? cell.tags.filter(hasOwnColor).map((t) => t.color) : [];
      }),
    ),
  );

  // Cada evento es un tramo de días: una fila con rango (inicio → fin) o de un
  // solo día; las reuniones siempre de un día.
  const spans: { event: CalEvent; start: string; end: string }[] = [];
  const monthKeys = new Set<string>();

  for (const row of source === "all" ? db.rows : []) {
    const cell = row.cells[dateColumn];
    if (cell?.kind !== "date" || !cell.text) continue;

    const titleCell = db.titleColumn >= 0 ? row.cells[db.titleColumn] : undefined;
    const title = titleCell && "text" in titleCell ? titleCell.text : "Sin título";
    const event: CalEvent = {
      id: row.id,
      title,
      color: eventColor(row, [dateColumn, db.titleColumn]),
      details: rowDetails(db, row, [db.titleColumn]),
      ...deliverableOf(row.cells[deliverable], badgeColor),
    };
    spans.push({ event, start: cell.text, end: cell.end ?? cell.text });
  }
  // Las reuniones también extienden el rango de meses: una fuera del roadmap igual se ve.
  for (const { day, ...event } of db.extraEvents ?? []) spans.push({ event, start: day, end: day });

  for (const s of spans) {
    monthKeys.add(s.start.slice(0, 7));
    monthKeys.add(s.end.slice(0, 7));
  }
  // Primero lo que empieza antes y, a igual inicio, lo más largo: así las barras
  // largas quedan arriba. Las reuniones del mismo día, por hora.
  spans.sort(
    (a, b) =>
      a.start.localeCompare(b.start) || b.end.localeCompare(a.end) || (a.event.time ?? "").localeCompare(b.event.time ?? ""),
  );

  const sorted = [...monthKeys].sort();
  const keys: string[] = [];
  if (sorted.length) {
    let [y, m] = sorted[0].split("-").map(Number);
    const last = sorted[sorted.length - 1];
    for (;;) {
      const key = `${y}-${String(m).padStart(2, "0")}`;
      keys.push(key);
      if (key >= last) break;
      if (++m > 12) [y, m] = [y + 1, 1];
    }
  }

  const months = keys.map((key) => {
    const [y, m] = key.split("-").map(Number);
    const firstOfMonth = new Date(Date.UTC(y, m - 1, 1));
    // getUTCDay(): 0 = domingo. La semana acá empieza el lunes.
    const offset = (firstOfMonth.getUTCDay() + 6) % 7;
    const start = new Date(firstOfMonth.getTime() - offset * MS_DAY);
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const cells = Math.ceil((offset + daysInMonth) / 7) * 7;

    const weekDays: CalDay[][] = [];
    for (let i = 0; i < cells; i++) {
      const date = new Date(start.getTime() + i * MS_DAY);
      const key2 = iso(date);
      const day: CalDay = { iso: key2, day: date.getUTCDate(), inMonth: date.getUTCMonth() === m - 1, isToday: key2 === today };
      if (i % 7 === 0) weekDays.push([]);
      weekDays[weekDays.length - 1].push(day);
    }
    const weeks = weekDays.map((days) => placeWeek(days, spans));

    // Mes y año por separado: es-AR formatea "agosto de 2026" y el "de" sobra.
    const month = new Intl.DateTimeFormat("es-AR", { month: "long", timeZone: "UTC" }).format(firstOfMonth);
    return { key, label: `${month} ${y}`, weeks };
  });

  const current = today.slice(0, 7);
  const found = keys.indexOf(current);
  const initial = found >= 0 ? found : current > keys[keys.length - 1] ? keys.length - 1 : 0;

  // Dos líneas si la database tiene Entregable: todos los eventos miden lo mismo
  // para que los carriles sigan alineados.
  // Las reuniones siempre llevan su horario en la segunda línea.
  return { months, initial, twoLines: source === "extra" || deliverable >= 0 };
}

export const WEEKDAYS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
