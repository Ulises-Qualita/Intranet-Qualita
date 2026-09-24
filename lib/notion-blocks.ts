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
  | { kind: "date"; text: string }
  | { kind: "tags"; tags: Tag[] }
  | { kind: "check"; checked: boolean };

export type DbRow = { id: string; cells: DbCell[] };

export type EmbeddedDb = {
  columns: string[];
  rows: DbRow[];
  // Índices de la columna de título y de la de fecha (si hay). Con fecha, la
  // database se puede dibujar como calendario.
  titleColumn: number;
  dateColumn: number | null;
};

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
      return { kind: "date", text: ((p.date as { start?: string } | null)?.start ?? "").slice(0, 10) };
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
      const f = p.formula as { type: string; string?: string; number?: number; date?: { start?: string } } | undefined;
      if (f?.type === "date") return { kind: "date", text: (f.date?.start ?? "").slice(0, 10) };
      if (f?.type === "number") return { kind: "text", text: f.number == null ? "" : String(f.number) };
      return { kind: "text", text: f?.string ?? "" };
    }
    default:
      return { kind: "text", text: "" };
  }
}

// Filas crudas de una database → tabla lista para renderizar. El título va
// primero: es la columna que identifica cada fila.
export function toEmbeddedDb(pages: { id: string; properties: Record<string, RawDbProp> }[]): EmbeddedDb {
  const first = pages[0];
  if (!first) return { columns: [], rows: [], titleColumn: 0, dateColumn: null };

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

  return { columns, rows, titleColumn: titleName ? 0 : -1, dateColumn: dateCol >= 0 ? dateCol : null };
}

// ---------- Calendario ----------

export type CalEvent = { id: string; title: string; color: string };
export type CalDay = { iso: string; day: number; inMonth: boolean; isToday: boolean; events: CalEvent[] };
export type CalMonth = { key: string; label: string; weeks: CalDay[][] };

const MS_DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

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

// Meses corridos del primero al último que tienen filas (uno vacío en el medio se
// muestra igual, así pasar de mes avanza de a uno como en Notion), cada uno con su
// grilla de semanas de lunes a domingo. `initial` es el mes en el que abre la
// vista: el actual si cae en el rango, si no el extremo más cercano.
// `today` se pasa desde afuera para no congelarlo en el cache.
export function buildCalendar(
  db: EmbeddedDb,
  today: string,
): { months: CalMonth[]; undated: CalEvent[]; initial: number } {
  if (db.dateColumn === null) return { months: [], undated: [], initial: 0 };

  const undated: CalEvent[] = [];
  const byDay = new Map<string, CalEvent[]>();
  const monthKeys = new Set<string>();

  for (const row of db.rows) {
    const dateCell = row.cells[db.dateColumn];
    const titleCell = db.titleColumn >= 0 ? row.cells[db.titleColumn] : undefined;
    const title = titleCell && "text" in titleCell ? titleCell.text : "Sin título";
    const event: CalEvent = { id: row.id, title, color: eventColor(row, [db.dateColumn, db.titleColumn]) };

    const date = dateCell?.kind === "date" ? dateCell.text : "";
    if (!date) {
      undated.push(event);
      continue;
    }
    byDay.set(date, [...(byDay.get(date) ?? []), event]);
    monthKeys.add(date.slice(0, 7));
  }

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

    const weeks: CalDay[][] = [];
    for (let i = 0; i < cells; i++) {
      const date = new Date(start.getTime() + i * MS_DAY);
      const key2 = iso(date);
      const day: CalDay = {
        iso: key2,
        day: date.getUTCDate(),
        inMonth: date.getUTCMonth() === m - 1,
        isToday: key2 === today,
        events: byDay.get(key2) ?? [],
      };
      if (i % 7 === 0) weeks.push([]);
      weeks[weeks.length - 1].push(day);
    }

    // Mes y año por separado: es-AR formatea "agosto de 2026" y el "de" sobra.
    const month = new Intl.DateTimeFormat("es-AR", { month: "long", timeZone: "UTC" }).format(firstOfMonth);
    return { key, label: `${month} ${y}`, weeks };
  });

  const current = today.slice(0, 7);
  const found = keys.indexOf(current);
  const initial = found >= 0 ? found : current > keys[keys.length - 1] ? keys.length - 1 : 0;

  return { months, undated, initial };
}

export const WEEKDAYS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
