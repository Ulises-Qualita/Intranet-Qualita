"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { PLATFORMS, type Platform } from "@/lib/analysis/shared";
import {
  CRITERIA_BUCKET,
  criteriaFileType,
  MAX_CRITERION_TEXT,
  MAX_CRITERION_TITLE,
} from "@/lib/ad-criteria-shared";
import { createAdminClient, createClient, isMissingTable } from "@/lib/supabase/server";

// Criterio de pauta (Administración → Criterio de pauta). Solo un rol admin lo
// cambia; la RLS de intranet_ad_criteria lo vuelve a validar. El bucket es
// privado y se maneja con service_role.

export type CriteriaResult = { ok: true; error: null } | { ok: false; error: string };

const PATH = "/admin/criterio";
const NO_ADMIN: CriteriaResult = { ok: false, error: "Solo un administrador puede cambiar el criterio de pauta." };
const MISSING_TABLE: CriteriaResult = {
  ok: false,
  error: "Falta crear la tabla del criterio (docs/sql/2026-11-12-criterio-pauta.sql).",
};

async function requireAdmin() {
  const session = await getSession();
  return session?.profile?.role === "admin" && session.profile.active ? session : null;
}

const isPlatform = (v: unknown): v is Platform => PLATFORMS.some((p) => p.id === v);
const cleanTitle = (t: unknown) => String(t ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_CRITERION_TITLE);

function fail(where: string, error: unknown, message: string): CriteriaResult {
  if (isMissingTable(error as { code?: string })) return MISSING_TABLE;
  console.error(`[criterio] ${where}`, error);
  return { ok: false, error: message };
}

// Crea o edita un criterio escrito. En uno de archivo solo cambia el título.
export async function saveCriterion(input: {
  id: string | null;
  platform: string;
  title: string;
  content?: string;
}): Promise<CriteriaResult> {
  const session = await requireAdmin();
  if (!session) return NO_ADMIN;
  const title = cleanTitle(input.title);
  if (!title) return { ok: false, error: "Poné un título." };
  const supabase = await createClient();

  if (input.id) {
    const { data: current } = await supabase.from("intranet_ad_criteria").select("kind").eq("id", input.id).maybeSingle<{ kind: string }>();
    if (!current) return { ok: false, error: "Ese criterio ya no existe." };
    const patch: Record<string, unknown> = { title, updated_at: new Date().toISOString() };
    if (current.kind === "texto") {
      const content = String(input.content ?? "").trim();
      if (!content) return { ok: false, error: "Escribí el criterio." };
      if (content.length > MAX_CRITERION_TEXT) return { ok: false, error: "El texto es demasiado largo." };
      patch.content = content;
    }
    const { error } = await supabase.from("intranet_ad_criteria").update(patch).eq("id", input.id);
    if (error) return fail("editar", error, "No se pudo guardar el cambio.");
  } else {
    if (!isPlatform(input.platform)) return { ok: false, error: "Plataforma desconocida." };
    const content = String(input.content ?? "").trim();
    if (!content) return { ok: false, error: "Escribí el criterio." };
    if (content.length > MAX_CRITERION_TEXT) return { ok: false, error: "El texto es demasiado largo." };
    const { error } = await supabase
      .from("intranet_ad_criteria")
      .insert({ platform: input.platform, kind: "texto", title, content, created_by: session.user.id });
    if (error) return fail("crear", error, "No se pudo guardar el criterio.");
  }

  revalidatePath(PATH);
  return { ok: true, error: null };
}

// Paso 1 de la subida: valida el archivo y arma la URL firmada. El navegador sube
// directo a Storage (sin pasar por el server, que tiene tope de tamaño).
export async function createCriterionUpload(
  platform: string,
  file: { name: string; size: number },
): Promise<{ ok: true; path: string; token: string } | { ok: false; error: string }> {
  if (!(await requireAdmin())) return NO_ADMIN as { ok: false; error: string };
  if (!isPlatform(platform)) return { ok: false, error: "Plataforma desconocida." };
  const type = criteriaFileType(file.name);
  if (!type) return { ok: false, error: "Subí un PDF, Word (.docx), texto (.txt, .md, .csv) o imagen (PNG, JPG, WebP)." };
  if (file.size > type.max) return { ok: false, error: `Ese archivo pasa el máximo de ${Math.round(type.max / 1024 / 1024)} MB.` };

  const { data, error } = await createAdminClient()
    .storage.from(CRITERIA_BUCKET)
    .createSignedUploadUrl(`${platform}/${randomUUID()}`);
  if (error || !data) {
    console.error("[criterio] url firmada", error);
    return { ok: false, error: "No se pudo preparar la subida. ¿Se corrió docs/sql/2026-11-12-criterio-pauta.sql?" };
  }
  return { ok: true, path: data.path, token: data.token };
}

// Paso 2: el archivo ya está en Storage. De los Word y los de texto se guarda el
// texto (Claude no lee .docx); los PDF y las imágenes se mandan tal cual.
export async function criterionUploaded(platform: string, path: string, fileName: string): Promise<CriteriaResult> {
  const session = await requireAdmin();
  if (!session) return NO_ADMIN;
  if (!isPlatform(platform) || !path.startsWith(`${platform}/`) || path.includes("..")) return { ok: false, error: "Archivo inválido." };
  const type = criteriaFileType(fileName);
  if (!type) return { ok: false, error: "Tipo de archivo no admitido." };

  const storage = createAdminClient().storage.from(CRITERIA_BUCKET);
  const { data: blob, error: downloadError } = await storage.download(path);
  if (downloadError || !blob) return fail("bajar", downloadError, "No se encontró el archivo subido.");
  const remove = () => storage.remove([path]);
  if (blob.size > type.max) {
    await remove();
    return { ok: false, error: "El archivo pasa el máximo permitido." };
  }

  let content: string | null = null;
  try {
    const buffer = Buffer.from(await blob.arrayBuffer());
    if (type.mime.startsWith("text/")) content = buffer.toString("utf8");
    else if (type.label === "Word") {
      const mammoth = await import("mammoth");
      content = (await mammoth.extractRawText({ buffer })).value;
    }
  } catch (e) {
    await remove();
    return fail("extraer", e, "No se pudo leer el archivo. Probá exportarlo como PDF.");
  }
  if (content !== null) {
    content = content.replace(/\n{3,}/g, "\n\n").trim();
    if (!content) {
      await remove();
      return { ok: false, error: "El archivo no tiene texto para leer." };
    }
    if (content.length > MAX_CRITERION_TEXT) {
      await remove();
      return { ok: false, error: "El archivo tiene demasiado texto. Subí solo la parte del criterio." };
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.from("intranet_ad_criteria").insert({
    platform,
    kind: "archivo",
    title: cleanTitle(fileName.replace(/\.[^.]+$/, "")) || "Archivo",
    content,
    file_path: path,
    file_name: fileName.slice(0, 200),
    mime_type: type.mime,
    size: blob.size,
    created_by: session.user.id,
  });
  if (error) {
    await remove();
    return fail("guardar archivo", error, "No se pudo guardar el archivo.");
  }

  revalidatePath(PATH);
  return { ok: true, error: null };
}

export async function setCriterionActive(id: string, active: boolean): Promise<CriteriaResult> {
  if (!(await requireAdmin())) return NO_ADMIN;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("intranet_ad_criteria")
    .update({ active: active === true, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id");
  if (error || !data?.length) return fail("activar", error, "No se pudo guardar el cambio.");
  revalidatePath(PATH);
  return { ok: true, error: null };
}

export async function deleteCriterion(id: string): Promise<CriteriaResult> {
  if (!(await requireAdmin())) return NO_ADMIN;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("intranet_ad_criteria")
    .delete()
    .eq("id", id)
    .select("file_path")
    .returns<{ file_path: string | null }[]>();
  if (error || !data?.length) return fail("borrar", error, "No se pudo borrar el criterio.");
  const path = data[0].file_path;
  if (path) await createAdminClient().storage.from(CRITERIA_BUCKET).remove([path]);
  revalidatePath(PATH);
  return { ok: true, error: null };
}

// Link temporal para abrir el archivo original (el bucket es privado).
export async function criterionFileUrl(id: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!(await getSession())?.profile) return { ok: false, error: "Sin acceso." };
  const supabase = await createClient();
  const { data } = await supabase.from("intranet_ad_criteria").select("file_path, file_name").eq("id", id).maybeSingle<{
    file_path: string | null;
    file_name: string | null;
  }>();
  if (!data?.file_path) return { ok: false, error: "No se encontró el archivo." };
  const { data: signed, error } = await createAdminClient()
    .storage.from(CRITERIA_BUCKET)
    .createSignedUrl(data.file_path, 300, { download: data.file_name ?? true });
  if (error || !signed) return { ok: false, error: "No se pudo abrir el archivo." };
  return { ok: true, url: signed.signedUrl };
}
