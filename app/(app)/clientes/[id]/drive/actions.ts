"use server";

import { headers } from "next/headers";
import { getDriveAccess } from "@/lib/drive-access";
import { createUploadSession, DRIVE_MAX_UPLOAD, driveErrorMessage, getItem, isDriveId, isInside } from "@/lib/drive";

export type UploadStart = { ok: true; url: string } | { ok: false; error: string };

// Abre la subida de un archivo a una carpeta del cliente. El archivo no pasa por
// acá: el navegador lo sube directo a la URL que se devuelve. La usan el equipo
// (con el slug) y la cuenta del cliente (slug null: siempre su carpeta).
export async function createDriveUpload(
  slug: string | null,
  folderId: string,
  file: { name: string; size: number; type: string },
): Promise<UploadStart> {
  const access = await getDriveAccess(slug);
  if (!access) return { ok: false, error: "No tenés acceso a esta carpeta." };
  if (!isDriveId(folderId)) return { ok: false, error: "Carpeta inválida." };

  const name = String(file.name ?? "").trim();
  if (!name || name.length > 255) return { ok: false, error: "El nombre del archivo no es válido." };
  if (!Number.isFinite(file.size) || file.size <= 0) return { ok: false, error: "El archivo está vacío." };
  if (file.size > DRIVE_MAX_UPLOAD) return { ok: false, error: "El archivo supera el máximo de 1 GB." };

  const origin = (await headers()).get("origin");
  if (!origin) return { ok: false, error: "No se pudo iniciar la subida." };

  try {
    if (!(await isInside(access.rootId, folderId))) return { ok: false, error: "No tenés acceso a esta carpeta." };
    if (!(await getItem(folderId)).isFolder) return { ok: false, error: "Solo se puede subir a una carpeta." };
    const url = await createUploadSession({
      folderId,
      name,
      mimeType: String(file.type ?? ""),
      size: file.size,
      origin,
      uploadedBy: access.who,
    });
    return { ok: true, url };
  } catch (e) {
    console.error("[drive] subida", folderId, e);
    return { ok: false, error: driveErrorMessage(e) };
  }
}
