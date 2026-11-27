"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getAreaSession } from "@/lib/auth";
import { checkGoogleFonts, hierarchyTexts, normalizeBrand } from "@/lib/brand";
import { APPS_VERSION, ASSET_MAX, CROP_VERSION, type AssetKind, type BrandApplication, BRAND_BUCKET, BRAND_PDF_MAX, BRAND_PDF_MAX_LABEL, isAssetKind, isResourceCategory } from "@/lib/brand-shared";
import { createAdminClient, createClient, isMissingTable } from "@/lib/supabase/server";

// Manual de marca: solo el equipo con el área Clientes que ve al cliente (la RLS
// lo vuelve a validar al escribir). El bucket es privado y se maneja con
// service_role; las subidas van del navegador a Storage con URL firmada.

export type BrandResult = { ok: true; error: null } | { ok: false; error: string };

const NO_ACCESS: BrandResult = { ok: false, error: "No tenés acceso a este cliente." };
const MISSING: BrandResult = { ok: false, error: "Falta crear las tablas del manual (docs/sql/2026-11-12-manual-de-marca.sql)." };

async function teamFor(clientId: string) {
  const session = await getAreaSession("clientes");
  if (!session) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("intranet_clients").select("slug").eq("id", clientId).maybeSingle<{ slug: string }>();
  return data ? { session, supabase, slug: data.slug } : null;
}

const bucket = () => createAdminClient().storage.from(BRAND_BUCKET);
const safeName = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .slice(-80);

function fail(where: string, error: unknown, message: string): BrandResult {
  if (isMissingTable(error as { code?: string })) return MISSING;
  console.error(`[marca] ${where}`, error);
  return { ok: false, error: message };
}

// Tamaño real del objeto subido (no se confía en lo que manda el navegador).
async function objectSize(path: string): Promise<number | null> {
  const [folder, file] = [path.slice(0, path.lastIndexOf("/")), path.slice(path.lastIndexOf("/") + 1)];
  const { data } = await bucket().list(folder, { search: file, limit: 5 });
  const found = data?.find((o) => o.name === file);
  return found ? Number((found.metadata as { size?: number } | null)?.size ?? 0) : null;
}

// Paso 1 de cualquier subida: valida y firma. target = "pdf" (el manual),
// "aplicacion" (una imagen recortada del PDF) o un tipo de recurso.
export async function createBrandUpload(
  clientId: string,
  target: "pdf" | "aplicacion" | AssetKind,
  file: { name: string; size: number },
): Promise<{ ok: true; path: string; token: string } | { ok: false; error: string }> {
  if (!(await teamFor(clientId))) return NO_ACCESS as { ok: false; error: string };
  if (target === "pdf") {
    if (!/\.pdf$/i.test(file.name)) return { ok: false, error: "El manual tiene que ser un PDF." };
    if (file.size > BRAND_PDF_MAX) return { ok: false, error: `El PDF pasa los ${BRAND_PDF_MAX_LABEL}. Exportalo más liviano (imágenes comprimidas).` };
  } else if (target === "aplicacion") {
    if (!/.(jpe?g|png|webp)$/i.test(file.name) || file.size > 20 * 1024 * 1024) return { ok: false, error: "Imagen inválida." };
  } else {
    if (!isAssetKind(target)) return { ok: false, error: "Tipo de recurso desconocido." };
    if (file.size > ASSET_MAX) return { ok: false, error: "El archivo pasa los 115 MB." };
  }
  const path = `${clientId}/${target}/${randomUUID().slice(0, 8)}-${safeName(file.name)}`;
  const { data, error } = await bucket().createSignedUploadUrl(path);
  if (error || !data) {
    console.error("[marca] url firmada", error);
    return { ok: false, error: "No se pudo preparar la subida. ¿Se corrió docs/sql/2026-11-12-manual-de-marca.sql?" };
  }
  return { ok: true, path: data.path, token: data.token };
}

// Paso 2 del PDF: queda guardado y listo para leer. El PDF anterior se borra; los
// datos ya cargados quedan hasta que se vuelva a leer el nuevo.
export async function brandPdfUploaded(clientId: string, path: string, fileName: string): Promise<BrandResult> {
  const team = await teamFor(clientId);
  if (!team) return NO_ACCESS;
  if (!path.startsWith(`${clientId}/pdf/`)) return { ok: false, error: "Archivo inválido." };
  const size = await objectSize(path);
  if (size === null) return { ok: false, error: "No se encontró el PDF subido." };

  const { data: previous } = await team.supabase
    .from("intranet_brand_books")
    .select("pdf_path, data")
    .eq("client_id", clientId)
    .maybeSingle<{ pdf_path: string | null; data: unknown }>();
  // Con un PDF nuevo (p. ej. el mismo manual exportado en alta), las imágenes ya
  // recortadas se vuelven a recortar solas de él con las mismas cajas
  // (useAutoRecrop en brand-board): se borra la marca de recorte.
  const kept = previous?.data ? normalizeBrand(previous.data) : null;
  const { error } = await team.supabase.from("intranet_brand_books").upsert({
    client_id: clientId,
    ...(kept ? { data: { ...kept, applicationsCrop: undefined } } : {}),
    pdf_path: path,
    pdf_name: fileName.slice(0, 200),
    pdf_size: size,
    status: "sin_extraer",
    error: null,
    updated_by: team.session.user.id,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    await bucket().remove([path]);
    return fail("guardar pdf", error, "No se pudo guardar el PDF.");
  }
  if (previous?.pdf_path && previous.pdf_path !== path) await bucket().remove([previous.pdf_path]);
  revalidatePath(`/clientes/${team.slug}/marca`);
  return { ok: true, error: null };
}

export async function brandAssetUploaded(clientId: string, kind: string, path: string, fileName: string, mimeType: string): Promise<BrandResult> {
  const team = await teamFor(clientId);
  if (!team) return NO_ACCESS;
  if (!isAssetKind(kind) || !path.startsWith(`${clientId}/${kind}/`)) return { ok: false, error: "Archivo inválido." };
  const size = await objectSize(path);
  if (size === null) return { ok: false, error: "No se encontró el archivo subido." };
  const { error } = await team.supabase.from("intranet_brand_assets").insert({
    client_id: clientId,
    kind,
    name: fileName.replace(/\.[^.]+$/, "").slice(0, 120) || fileName,
    file_path: path,
    file_name: fileName.slice(0, 200),
    mime_type: mimeType.slice(0, 120) || null,
    size,
    created_by: team.session.user.id,
  });
  if (error) {
    await bucket().remove([path]);
    return fail("guardar recurso", error, "No se pudo guardar el archivo.");
  }
  revalidatePath(`/clientes/${team.slug}/marca`);
  return { ok: true, error: null };
}

export async function deleteBrandAsset(clientId: string, id: string): Promise<BrandResult> {
  const team = await teamFor(clientId);
  if (!team) return NO_ACCESS;
  const { data, error } = await team.supabase
    .from("intranet_brand_assets")
    .delete()
    .eq("id", id)
    .eq("client_id", clientId)
    .select("file_path")
    .returns<{ file_path: string }[]>();
  if (error || !data?.length) return fail("borrar recurso", error, "No se pudo borrar el archivo.");
  await bucket().remove([data[0].file_path]);
  revalidatePath(`/clientes/${team.slug}/marca`);
  return { ok: true, error: null };
}

// Borra el PDF y lo extraído. Los recursos subidos a mano quedan.
export async function deleteBrandBook(clientId: string): Promise<BrandResult> {
  const team = await teamFor(clientId);
  if (!team) return NO_ACCESS;
  const { data, error } = await team.supabase
    .from("intranet_brand_books")
    .delete()
    .eq("client_id", clientId)
    .select("pdf_path, data")
    .returns<{ pdf_path: string | null; data: unknown }[]>();
  if (error) return fail("borrar manual", error, "No se pudo borrar el manual.");
  const row = data?.[0];
  const saved = row?.data ? normalizeBrand(row.data) : null;
  const images = [...(saved?.applications ?? []).flatMap((a) => (a.path ? [a.path] : [])), ...(saved?.applicationPages ?? []).map((p) => p.path)];
  const paths = [...(row?.pdf_path ? [row.pdf_path] : []), ...images];
  if (paths.length) await bucket().remove(paths);
  revalidatePath(`/clientes/${team.slug}/marca`);
  return { ok: true, error: null };
}

// Correcciones a mano (colores, tipografías, textos). Se vuelve a chequear qué
// familias están en Google Fonts.
export async function saveBrandData(clientId: string, raw: unknown): Promise<BrandResult> {
  const team = await teamFor(clientId);
  if (!team) return NO_ACCESS;
  const data = await checkGoogleFonts(normalizeBrand(raw));
  const { data: current } = await team.supabase
    .from("intranet_brand_books")
    .select("status, data")
    .eq("client_id", clientId)
    .maybeSingle<{ status: string; data: unknown }>();
  // El editor no toca las aplicaciones: quedan las guardadas (y sus páginas).
  const saved = current?.data ? normalizeBrand(current.data) : null;
  data.applications = saved?.applications;
  data.applicationPages = saved?.applicationPages;
  data.applicationsVersion = saved?.applicationsVersion;
  data.applicationsCrop = saved?.applicationsCrop;
  // Ni el principal ni los fondos de los logos se editan ahí.
  data.logo.main = saved?.logo.main;
  data.logo.allowed = saved?.logo.allowed;
  // Los ejemplos de tono tampoco (el editor no los muestra).
  data.voice.examples = saved?.voice.examples;
  data.hierarchy = saved?.hierarchy;
  data.resources = saved?.resources;
  const { error } = await team.supabase.from("intranet_brand_books").upsert({
    client_id: clientId,
    data,
    status: current?.status === "extrayendo" ? "extrayendo" : "listo",
    error: null,
    updated_by: team.session.user.id,
    updated_at: new Date().toISOString(),
  });
  if (error) return fail("guardar datos", error, "No se pudieron guardar los cambios.");
  revalidatePath(`/clientes/${team.slug}/marca`);
  return { ok: true, error: null };
}

// Cuál de los logos subidos es el principal (el que muestra el tablero).
export async function setMainLogo(clientId: string, assetId: string): Promise<BrandResult> {
  const team = await teamFor(clientId);
  if (!team) return NO_ACCESS;
  const { data: asset } = await team.supabase
    .from("intranet_brand_assets")
    .select("id")
    .eq("id", assetId)
    .eq("client_id", clientId)
    .eq("kind", "logo")
    .maybeSingle<{ id: string }>();
  if (!asset) return { ok: false, error: "No se encontró el logo." };
  const { data: row } = await team.supabase
    .from("intranet_brand_books")
    .select("data, status")
    .eq("client_id", clientId)
    .maybeSingle<{ data: unknown; status: string }>();
  const data = normalizeBrand(row?.data ?? {});
  const { error } = await team.supabase.from("intranet_brand_books").upsert({
    client_id: clientId,
    data: { ...data, logo: { ...data.logo, main: assetId } },
    status: row?.status ?? "listo",
    updated_by: team.session.user.id,
    updated_at: new Date().toISOString(),
  });
  if (error) return fail("logo principal", error, "No se pudo marcar el logo principal.");
  revalidatePath(`/clientes/${team.slug}/marca`);
  return { ok: true, error: null };
}

// Categoría de un recurso (iconografía, tramas…) elegida por el equipo.
export async function setResourceCategory(clientId: string, assetId: string, category: string): Promise<BrandResult> {
  const team = await teamFor(clientId);
  if (!team) return NO_ACCESS;
  if (!isResourceCategory(category)) return { ok: false, error: "Categoría inválida." };
  const { data: asset } = await team.supabase
    .from("intranet_brand_assets")
    .select("id")
    .eq("id", assetId)
    .eq("client_id", clientId)
    .neq("kind", "logo")
    .maybeSingle<{ id: string }>();
  if (!asset) return { ok: false, error: "No se encontró el recurso." };
  const { data, status } = await currentData(team, clientId);
  const { error } = await team.supabase.from("intranet_brand_books").upsert({
    client_id: clientId,
    data: { ...data, resources: { ...data.resources, [assetId]: category } },
    status,
    updated_by: team.session.user.id,
    updated_at: new Date().toISOString(),
  });
  if (error) return fail("categoría del recurso", error, "No se pudo cambiar la categoría.");
  revalidatePath(`/clientes/${team.slug}/marca`);
  return { ok: true, error: null };
}

// Textos de muestra del panel Jerarquía (null = volver a los automáticos).
export async function saveHierarchyTexts(clientId: string, raw: { titles: string[]; text: string | null } | null): Promise<BrandResult> {
  const team = await teamFor(clientId);
  if (!team) return NO_ACCESS;
  const { data: row } = await team.supabase
    .from("intranet_brand_books")
    .select("data, status")
    .eq("client_id", clientId)
    .maybeSingle<{ data: unknown; status: string }>();
  if (!row) return { ok: false, error: "Todavía no hay manual cargado." };
  const data = normalizeBrand(row.data ?? {});
  const { error } = await team.supabase
    .from("intranet_brand_books")
    .update({
      data: { ...data, hierarchy: raw ? hierarchyTexts(raw) : undefined },
      updated_by: team.session.user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("client_id", clientId);
  if (error) return fail("textos de jerarquía", error, "No se pudieron guardar los textos.");
  revalidatePath(`/clientes/${team.slug}/marca`);
  return { ok: true, error: null };
}

// ---------- Aplicaciones (imágenes recortadas del PDF) ----------

async function currentData(team: NonNullable<Awaited<ReturnType<typeof teamFor>>>, clientId: string) {
  const { data: row } = await team.supabase
    .from("intranet_brand_books")
    .select("data, status")
    .eq("client_id", clientId)
    .maybeSingle<{ data: unknown; status: string }>();
  return { data: normalizeBrand(row?.data ?? {}), status: row?.status ?? "listo" };
}

// Guarda la lista de aplicaciones ya recortadas (cada una con su imagen en
// `{clientId}/aplicacion/`). Reemplaza la anterior y borra las imágenes viejas
// (también las de páginas que guardaba una versión anterior).
// keepVersion: volver a recortar las mismas cajas (no cambia el criterio con que se marcaron).
export async function saveBrandApplications(clientId: string, items: BrandApplication[], keepVersion = false): Promise<BrandResult> {
  const team = await teamFor(clientId);
  if (!team) return NO_ACCESS;
  const prefix = `${clientId}/aplicacion/`;
  const valid = normalizeBrand({ applications: items }).applications ?? [];
  const checked = (
    await Promise.all(valid.map(async (a) => (a.path?.startsWith(prefix) && (await objectSize(a.path)) !== null ? a : null)))
  ).filter((a): a is BrandApplication => !!a);
  const { data, status } = await currentData(team, clientId);
  const keep = new Set(checked.map((a) => a.path));
  const old = [...(data.applications ?? []).flatMap((a) => (a.path ? [a.path] : [])), ...(data.applicationPages ?? []).map((p) => p.path)].filter(
    (path) => !keep.has(path),
  );
  const { error } = await team.supabase.from("intranet_brand_books").upsert({
    client_id: clientId,
    data: {
      ...data,
      applications: checked,
      applicationPages: undefined,
      applicationsVersion: keepVersion ? data.applicationsVersion : APPS_VERSION,
      applicationsCrop: CROP_VERSION,
      applicationsDraft: undefined,
    },
    status,
    updated_by: team.session.user.id,
    updated_at: new Date().toISOString(),
  });
  if (error) return fail("guardar aplicaciones", error, "No se pudieron guardar las aplicaciones.");
  if (old.length) await bucket().remove(old);
  revalidatePath(`/clientes/${team.slug}/marca`);
  return { ok: true, error: null };
}

// Saca una aplicación (por su posición en la lista) y borra su imagen.
export async function deleteBrandApplication(clientId: string, index: number): Promise<BrandResult> {
  const team = await teamFor(clientId);
  if (!team) return NO_ACCESS;
  const { data, status } = await currentData(team, clientId);
  const list = data.applications ?? [];
  const gone = list[index];
  if (!gone) return { ok: false, error: "No se encontró la imagen." };
  const { error } = await team.supabase.from("intranet_brand_books").upsert({
    client_id: clientId,
    data: { ...data, applications: list.filter((_, i) => i !== index) },
    status,
    updated_by: team.session.user.id,
    updated_at: new Date().toISOString(),
  });
  if (error) return fail("borrar aplicación", error, "No se pudo borrar la imagen.");
  if (gone.path) await bucket().remove([gone.path]);
  revalidatePath(`/clientes/${team.slug}/marca`);
  return { ok: true, error: null };
}
