// Reuniones de Notion para los cerebros (Cargar información → Reunión → De Notion).
// Solo server: se llama después de validar la sesión del equipo.
//
// Las páginas de la database de Reuniones son notas de reunión de Notion AI: un
// bloque `meeting_notes` con tres hijos (resumen, notas y transcripción), cada
// uno con su texto adentro. Se lee todo con el NOTION_TOKEN del workspace, solo
// de la database configurada en /admin/notion (o la detectada).
import {
  type NotionDataSource,
  type NotionPage,
  type NotionRawBlock,
  getBlockChildren,
  getDataSource,
  getPage,
  notionConfigured,
  queryDataSource,
  searchDataSources,
} from "./notion";
import { normalizeId } from "./notion-map";
import {
  type NotionMeeting,
  type NotionPartKey,
  NOTION_PART_KEYS,
  NOTION_PART_LABEL,
  notionRef,
} from "./brain-meetings-shared";
import { getNotionConfig } from "./data";
import { createAdminClient } from "./supabase/server";

// Cuánto para atrás se listan reuniones (igual que el calendario).
export const NOTION_DAYS = 60;

export class BrainNotionError extends Error {}

type RichPart = { type?: string; plain_text?: string; mention?: { type?: string; date?: { start?: string } } };

// La database de Reuniones: la elegida en /admin/notion o, si no se eligió, la
// primera que tenga "reuni" en el nombre y una propiedad de fecha (en Qualita,
// "Reuniones - Operaciones"; la otra "Reuniones" no tiene fecha).
async function meetingsSource(): Promise<NotionDataSource> {
  if (!notionConfigured()) throw new BrainNotionError("Falta configurar NOTION_TOKEN en el servidor.");
  const config = await getNotionConfig();
  if (config?.meetingsDataSourceId) return getDataSource(config.meetingsDataSourceId);
  const found = (await searchDataSources()).find(
    (ds) => /reuni/i.test(ds.name) && ds.properties.some((p) => p.type === "date"),
  );
  if (!found) {
    throw new BrainNotionError(
      "No encontramos la database de Reuniones en Notion. Elegila en Administración → Notion, o compartila con la integración.",
    );
  }
  return found;
}

const propOf = (page: NotionPage, type: string) => Object.values(page.properties).find((v) => v.type === type);

// El título sin la mención de fecha que Notion AI le pega al final.
function titleOf(page: NotionPage) {
  const parts = (propOf(page, "title")?.title ?? []) as RichPart[];
  const text = parts
    .filter((p) => p.type !== "mention")
    .map((p) => p.plain_text ?? "")
    .join("")
    .replace(/\s+/g, " ")
    .replace(/[\s-–]+$/, "")
    .trim();
  const mention = parts.find((p) => p.mention?.type === "date")?.mention?.date?.start ?? null;
  return { title: text || "Sin título", mentionDate: mention };
}

function toMeeting(page: NotionPage & { created_time?: string }, loaded: Set<string>): NotionMeeting {
  const { title, mentionDate } = titleOf(page);
  const date = propOf(page, "date")?.date?.start ?? mentionDate ?? page.created_time ?? null;
  const people = Object.values(page.properties)
    .filter((p) => p.type === "people")
    .flatMap((p) => (p.people ?? []).map((x) => x.name?.trim()).filter((n): n is string => !!n));
  const category = propOf(page, "select")?.select?.name ?? null;
  return { id: page.id, title, date, participants: [...new Set(people)], category, loaded: loaded.has(notionRef(page.id)) };
}

// Las reuniones de los últimos 60 días, de la más nueva a la más vieja.
export async function listNotionMeetings(area: string): Promise<NotionMeeting[]> {
  const ds = await meetingsSource();
  const since = new Date(Date.now() - NOTION_DAYS * 86_400_000).toISOString();
  const pages = await queryDataSource(ds.id, {
    filter: { timestamp: "created_time", created_time: { on_or_after: since } },
    sorts: [{ timestamp: "created_time", direction: "descending" }],
  });

  const { data } = await createAdminClient()
    .from("intranet_brain_meetings")
    .select("drive_ids")
    .eq("area", area)
    .eq("status", "guardada")
    .returns<{ drive_ids: string[] | null }[]>();
  const loaded = new Set((data ?? []).flatMap((r) => r.drive_ids ?? []));

  // Las páginas vacías (sin título ni nada) son reuniones que se crearon y no se usaron.
  return pages.map((p) => toMeeting(p, loaded)).filter((m) => m.title !== "Sin título");
}

// ---------- Texto de una página ----------

const richText = (block: NotionRawBlock) => {
  const body = block[block.type] as { rich_text?: RichPart[] } | undefined;
  return (body?.rich_text ?? []).map((p) => p.plain_text ?? "").join("").trim();
};

// Bloques → texto plano con algo de forma (títulos y viñetas), con sus hijos.
async function blocksText(blocks: NotionRawBlock[], depth = 0): Promise<string[]> {
  const lines: string[] = [];
  const pad = "  ".repeat(depth);
  for (const b of blocks) {
    const text = richText(b);
    if (b.type === "heading_1" || b.type === "heading_2" || b.type === "heading_3") {
      if (text) lines.push(`\n${"#".repeat(Number(b.type.slice(-1)) + 1)} ${text}`);
    } else if (b.type === "bulleted_list_item" || b.type === "numbered_list_item" || b.type === "toggle") {
      if (text) lines.push(`${pad}- ${text}`);
    } else if (b.type === "to_do") {
      const done = (b.to_do as { checked?: boolean } | undefined)?.checked;
      if (text) lines.push(`${pad}- [${done ? "x" : " "}] ${text}`);
    } else if (text) {
      lines.push(`${pad}${text}`);
    }
    // Una subpágina o una base embebida no son parte de la reunión.
    if (b.has_children && depth < 4 && b.type !== "child_page" && b.type !== "child_database") {
      lines.push(...(await blocksText(await getBlockChildren(b.id), depth + 1)));
    }
  }
  return lines;
}

type MeetingNotesBody = {
  children?: { summary_block_id?: string; notes_block_id?: string; transcript_block_id?: string };
};

// Valida que la página sea de la database de Reuniones (el token ve todo el
// workspace) y saca el texto de cada parte.
async function readParts(pageId: string) {
  if (!/^[\da-f-]{32,36}$/i.test(pageId)) throw new BrainNotionError("Reunión no encontrada.");
  const ds = await meetingsSource();
  const page = await getPage(pageId).catch(() => null);
  if (!page?.parent?.data_source_id || normalizeId(page.parent.data_source_id) !== normalizeId(ds.id)) {
    throw new BrainNotionError("Esa página no es de la database de Reuniones.");
  }

  const parts: Partial<Record<NotionPartKey, string>> = {};
  const add = (key: NotionPartKey, text: string) => {
    if (text) parts[key] = parts[key] ? `${parts[key]}\n\n${text}` : text;
  };
  const rest: NotionRawBlock[] = [];
  for (const b of await getBlockChildren(page.id)) {
    const ids = b.type === "meeting_notes" ? (b.meeting_notes as MeetingNotesBody | undefined)?.children : undefined;
    if (!ids) {
      rest.push(b);
      continue;
    }
    for (const [key, id] of [
      ["resumen", ids.summary_block_id],
      ["notas", ids.notes_block_id],
      ["transcripcion", ids.transcript_block_id],
    ] as const) {
      if (id) add(key, (await blocksText(await getBlockChildren(id))).join("\n").trim());
    }
  }
  add("pagina", (await blocksText(rest)).join("\n").trim());
  return { page: toMeeting(page, new Set()), parts };
}

// El texto de la reunión, listo para interpretar. Se elige la reunión entera, no
// sus partes (pedido): va la transcripción; si la página no tiene, lo que haya
// (resumen, notas y el texto de la página).
export async function readNotionMeeting(pageId: string) {
  const { page, parts } = await readParts(pageId);
  const keys: NotionPartKey[] = parts.transcripcion ? ["transcripcion"] : NOTION_PART_KEYS.filter((k) => parts[k]);
  if (!keys.length) throw new BrainNotionError("Esta reunión todavía no tiene transcripción ni notas en Notion.");
  const text = keys.map((k) => `### ${NOTION_PART_LABEL[k]}\n\n${parts[k]}`).join("\n\n");
  return { page, text };
}
