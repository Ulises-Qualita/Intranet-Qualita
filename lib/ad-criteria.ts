// Criterio de pauta: lectura y armado de lo que recibe Claude en "Analizar
// plataforma". Solo server. Tabla y bucket: docs/sql/2026-11-12-criterio-pauta.sql.
import type Anthropic from "@anthropic-ai/sdk";
import type { Platform } from "./analysis/shared";
import { type AdCriterion, CRITERIA_BUCKET } from "./ad-criteria-shared";
import { createAdminClient, createClient, isMissingTable } from "./supabase/server";

type Row = {
  id: string;
  platform: Platform;
  kind: AdCriterion["kind"];
  title: string;
  content: string | null;
  file_path: string | null;
  file_name: string | null;
  mime_type: string | null;
  size: number | null;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

const toCriterion = (r: Row): AdCriterion => ({
  id: r.id,
  platform: r.platform,
  kind: r.kind,
  title: r.title,
  content: r.content,
  filePath: r.file_path,
  fileName: r.file_name,
  mimeType: r.mime_type,
  size: r.size,
  active: r.active,
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

// Con la sesión del usuario (RLS: área admin, área META o admin). null si la tabla
// todavía no existe.
export async function getAdCriteria(platform?: Platform, onlyActive = false): Promise<AdCriterion[] | null> {
  const supabase = await createClient();
  let query = supabase.from("intranet_ad_criteria").select("*").order("created_at");
  if (platform) query = query.eq("platform", platform);
  if (onlyActive) query = query.eq("active", true);
  const { data, error } = await query.returns<Row[]>();
  if (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  return (data ?? []).map(toCriterion);
}

// Tope de archivos (PDF e imágenes) que viajan en un análisis: el pedido a Claude
// tiene un límite de tamaño y el contexto de la cuenta también ocupa.
const MAX_ATTACHED_BYTES = 15 * 1024 * 1024;

type Block = Anthropic.Messages.ContentBlockParam;

// El criterio activo de la plataforma como bloques del mensaje a Claude: los
// textos (escritos o extraídos de un Word) como documentos de texto, los PDF y
// las imágenes tal cual. Lo que no se pueda leer se saltea: el análisis sigue.
export async function criteriaBlocks(platform: Platform): Promise<{ blocks: Block[]; titles: string[] }> {
  const criteria = (await getAdCriteria(platform, true).catch((e) => {
    console.error("[criterio] leer", e);
    return null;
  })) ?? [];
  const storage = createAdminClient().storage.from(CRITERIA_BUCKET);
  let attached = 0;

  const built = await Promise.all(
    criteria.map(async (c): Promise<Block[]> => {
      if (c.content?.trim()) {
        return [{ type: "document", title: c.title, source: { type: "text", media_type: "text/plain", data: c.content } }];
      }
      if (!c.filePath || !c.mimeType || !c.size) return [];
      if (attached + c.size > MAX_ATTACHED_BYTES) {
        console.warn("[criterio] se saltea por tamaño:", c.title);
        return [];
      }
      attached += c.size;
      const { data, error } = await storage.download(c.filePath);
      if (error || !data) {
        console.warn("[criterio] no se pudo bajar", c.title, error);
        return [];
      }
      const base64 = Buffer.from(await data.arrayBuffer()).toString("base64");
      if (c.mimeType === "application/pdf") {
        return [{ type: "document", title: c.title, source: { type: "base64", media_type: "application/pdf", data: base64 } }];
      }
      if (c.mimeType === "image/png" || c.mimeType === "image/jpeg" || c.mimeType === "image/webp") {
        return [
          { type: "text", text: `Imagen del criterio: ${c.title}` },
          { type: "image", source: { type: "base64", media_type: c.mimeType, data: base64 } },
        ];
      }
      return [];
    }),
  );

  const blocks = built.flat();
  return { blocks, titles: criteria.filter((_, i) => built[i].length).map((c) => c.title) };
}
