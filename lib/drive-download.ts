// Descarga de un archivo de la carpeta de Drive de un cliente. Solo server.
// La sirven dos rutas con el mismo código: /api/drive/[fileId] (equipo, con
// ?cliente=<slug>) y /mi-empresa/drive/archivo/[fileId] (cuenta del cliente;
// proxy.ts no la deja salir de /mi-empresa).
import { getDriveAccess } from "./drive-access";
import { DriveError, downloadFile, driveErrorMessage, getItem, isDownloadable, isDriveId, isInside } from "./drive";

export async function serveDriveFile(fileId: string, slug: string | null) {
  if (!isDriveId(fileId)) return new Response("Archivo inválido", { status: 400 });

  const access = await getDriveAccess(slug);
  if (!access) return new Response("Sin acceso", { status: 403 });

  try {
    // La misma respuesta si no existe o si está fuera de la carpeta del cliente:
    // no se confirma la existencia de archivos ajenos.
    if (!(await isInside(access.rootId, fileId))) return new Response("Archivo no encontrado", { status: 404 });
    const item = await getItem(fileId);
    if (!isDownloadable(item)) return new Response("Este archivo no se puede descargar", { status: 415 });

    const { res, name, mimeType } = await downloadFile(item);
    const headers = new Headers({
      "Content-Type": mimeType,
      "Content-Disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]|"/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    const length = res.headers.get("content-length");
    if (length) headers.set("Content-Length", length);
    return new Response(res.body, { headers });
  } catch (e) {
    if (e instanceof DriveError && e.status === 404) return new Response("Archivo no encontrado", { status: 404 });
    console.error("[drive] descarga", fileId, e);
    return new Response(driveErrorMessage(e), { status: 502 });
  }
}
