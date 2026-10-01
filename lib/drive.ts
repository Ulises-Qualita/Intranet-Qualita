// Google Drive: la carpeta de cada cliente. Solo server.
//
// Todo pasa por la cuenta de servicio actuando como GOOGLE_DRIVE_USER (un usuario
// del estudio que es miembro de la unidad compartida con las carpetas de los
// clientes; ver lib/google.ts). El navegador nunca recibe un token: lista y
// descarga el server, y la subida va directo a Google con una sesión de subida
// que abre el server para una carpeta ya validada.
//
// Cada cliente tiene UNA carpeta raíz (intranet_client_integrations, provider
// "drive", account_ref = id de la carpeta). La regla de seguridad es una sola:
// cualquier archivo o carpeta que se pida tiene que estar DENTRO de esa raíz
// (isInside sube por los padres hasta encontrarla). Así un cliente no llega a la
// carpeta de otro aunque cambie el id en la URL.
//
// Desde la intranet se puede ver, descargar y subir; no se borra ni se crean
// carpetas (eso se hace en Drive).
import { googleAccessToken, googleConfigured, GoogleAuthError } from "./google";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const FOLDER = "application/vnd.google-apps.folder";

// Tope de una subida desde la intranet.
export const DRIVE_MAX_UPLOAD = 1024 * 1024 * 1024;

export const driveConfigured = () => googleConfigured() && Boolean(process.env.GOOGLE_DRIVE_USER);

export class DriveError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

export type DriveItem = {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  size: number | null;
  modifiedTime: string | null;
  webViewLink: string | null;
  // Drive tiene una vista previa (imágenes, PDFs, Docs…). Se sirve por
  // lib/drive-thumb.ts, nunca con el link de Google directo.
  hasThumbnail: boolean;
};

export type DriveCrumb = { id: string; name: string };

type RawFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
  hasThumbnail?: boolean;
  thumbnailLink?: string;
  parents?: string[];
  driveId?: string;
  trashed?: boolean;
};

const ITEM_FIELDS = "id,name,mimeType,size,modifiedTime,webViewLink,hasThumbnail";

const toItem = (f: RawFile): DriveItem => ({
  id: f.id,
  name: f.name,
  mimeType: f.mimeType,
  isFolder: f.mimeType === FOLDER,
  size: f.size ? Number(f.size) : null,
  modifiedTime: f.modifiedTime ?? null,
  webViewLink: f.webViewLink ?? null,
  hasThumbnail: Boolean(f.hasThumbnail),
});

// Los ids de Drive son alfanuméricos con - y _: cualquier otra cosa se rechaza
// antes de armar una URL o un query con él.
export const isDriveId = (id: unknown): id is string => typeof id === "string" && /^[\w-]{10,200}$/.test(id);

async function token() {
  try {
    return await googleAccessToken(process.env.GOOGLE_DRIVE_USER!, DRIVE_SCOPE);
  } catch (e) {
    if (e instanceof GoogleAuthError && e.code === "unauthorized_client") {
      throw new DriveError(
        "La cuenta de servicio no tiene autorizado el permiso de Drive (https://www.googleapis.com/auth/drive) en la delegación de dominio.",
      );
    }
    throw new DriveError(e instanceof Error ? e.message : "No se pudo autenticar con Google.");
  }
}

async function driveFetch(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${await token()}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    if (res.status === 404) {
      throw new DriveError("La carpeta o el archivo no existe, o la cuenta de Drive no tiene acceso.", 404);
    }
    throw new DriveError(body?.error?.message ?? `Google Drive respondió ${res.status}`, res.status);
  }
  return res;
}

const q = (params: Record<string, string>) =>
  new URLSearchParams({ supportsAllDrives: "true", ...params }).toString();

async function getRaw(id: string, fields = `${ITEM_FIELDS},parents,driveId,trashed`): Promise<RawFile> {
  return (await driveFetch(`${API}/files/${id}?${q({ fields })}`)).json();
}

// ---------- Lectura ----------

export async function getItem(id: string) {
  return toItem(await getRaw(id));
}

// Contenido de una carpeta: primero las carpetas, después los archivos, por nombre.
export function listFolder(folderId: string, onlyFolders = false): Promise<DriveItem[]> {
  return listWhere(`'${folderId}' in parents and trashed = false${onlyFolders ? ` and mimeType = '${FOLDER}'` : ""}`);
}

// Puntos de partida para elegir la carpeta de un cliente, además de las unidades
// compartidas: las carpetas del estudio no están en una unidad, son carpetas
// sueltas (de clientes o de gente del equipo) compartidas con GOOGLE_DRIVE_USER.
export const listSharedWithMe = () => listWhere(`mimeType = '${FOLDER}' and sharedWithMe and trashed = false`);
export const listMyDriveFolders = () => listWhere(`mimeType = '${FOLDER}' and 'root' in parents and trashed = false`);

// Carpetas por nombre, en todo lo que ve la cuenta.
export function searchFolders(term: string) {
  const safe = term.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return listWhere(`mimeType = '${FOLDER}' and name contains '${safe}' and trashed = false`, 100);
}

// Id real de "Mi unidad" de GOOGLE_DRIVE_USER: no se puede elegir como carpeta de
// un cliente (vería todo el Drive de esa cuenta).
export async function myDriveRootId() {
  return (await getRaw("root", "id")).id;
}

async function listWhere(filter: string, limit = Infinity): Promise<DriveItem[]> {
  const items: DriveItem[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < 20 && items.length < limit; i++) {
    const res = await driveFetch(
      `${API}/files?${q({
        q: filter,
        corpora: "allDrives",
        includeItemsFromAllDrives: "true",
        orderBy: "folder,name_natural",
        pageSize: "1000",
        fields: `nextPageToken,files(${ITEM_FIELDS})`,
        ...(pageToken ? { pageToken } : {}),
      })}`,
    );
    const body = await res.json();
    items.push(...(body.files as RawFile[]).map(toItem));
    pageToken = body.nextPageToken;
    if (!pageToken) break;
  }
  return items.slice(0, limit);
}

// Unidades compartidas de las que GOOGLE_DRIVE_USER es miembro.
export async function listSharedDrives(): Promise<DriveCrumb[]> {
  const res = await driveFetch(`${API}/drives?pageSize=100&fields=drives(id,name)`);
  return ((await res.json()).drives ?? []) as DriveCrumb[];
}

// Camino desde `rootId` hasta `id`, incluidos los dos extremos; sin `rootId`,
// desde la carpeta más alta que ve la cuenta. null si `id` no está dentro de
// `rootId`: esa es la verificación de acceso de todo el módulo.
export async function pathFrom(rootId: string | null, id: string): Promise<DriveCrumb[] | null> {
  const chain: DriveCrumb[] = [];
  let current: string | undefined = id;
  // Tope de profundidad por las dudas (y contra ciclos).
  for (let depth = 0; current && depth < 30; depth++) {
    let f: RawFile;
    try {
      f = await getRaw(current, "id,name,parents,driveId,trashed");
    } catch (e) {
      // Una carpeta compartida suelta tiene padres que la cuenta no ve: ahí se
      // termina el camino (y si todavía no apareció la raíz, está afuera).
      if (depth > 0 && e instanceof DriveError && e.status === 404) break;
      throw e;
    }
    if (f.trashed) return null;
    // La raíz de una unidad compartida viene como carpeta "Drive": se usa su nombre real.
    const name = f.driveId && f.id === f.driveId ? await sharedDriveName(f.id) : f.name;
    chain.unshift({ id: f.id, name });
    if (rootId && f.id === rootId) return chain;
    current = f.parents?.[0];
  }
  return rootId ? null : chain;
}

async function sharedDriveName(driveId: string) {
  try {
    return ((await (await driveFetch(`${API}/drives/${driveId}?fields=name`)).json()).name as string) ?? "Unidad compartida";
  } catch {
    return "Unidad compartida";
  }
}

export async function isInside(rootId: string, id: string) {
  return id === rootId || (await pathFrom(rootId, id)) !== null;
}

// ---------- Miniaturas ----------

// Vista previa de un archivo, pedida con el token de la cuenta (el link de Google
// no sirve sin sesión en archivos privados). `size`: lado mayor en px.
export async function fetchThumbnail(id: string, size = 480) {
  const f = await getRaw(id, "thumbnailLink,trashed");
  if (!f.thumbnailLink || f.trashed) return null;
  // El link termina en "=s220": se pide del tamaño que se va a mostrar.
  const url = f.thumbnailLink.replace(/=s\d+$/, `=s${size}`);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await token()}` }, cache: "no-store" });
  return res.ok ? res : null;
}

// ---------- Descarga ----------

// Los archivos nativos de Google no tienen binario: se exportan a un formato
// que se abre en cualquier compu.
const EXPORTS: Record<string, { mime: string; ext: string }> = {
  "application/vnd.google-apps.document": { mime: "application/pdf", ext: "pdf" },
  "application/vnd.google-apps.presentation": { mime: "application/pdf", ext: "pdf" },
  "application/vnd.google-apps.drawing": { mime: "application/pdf", ext: "pdf" },
  "application/vnd.google-apps.spreadsheet": {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ext: "xlsx",
  },
};

export const isDownloadable = (item: Pick<DriveItem, "mimeType" | "isFolder">) =>
  !item.isFolder && (!item.mimeType.startsWith("application/vnd.google-apps.") || item.mimeType in EXPORTS);

export async function downloadFile(item: DriveItem) {
  const exp = EXPORTS[item.mimeType];
  const res = exp
    ? await driveFetch(`${API}/files/${item.id}/export?${new URLSearchParams({ mimeType: exp.mime })}`)
    : await driveFetch(`${API}/files/${item.id}?${q({ alt: "media" })}`);
  const name = exp && !item.name.toLowerCase().endsWith(`.${exp.ext}`) ? `${item.name}.${exp.ext}` : item.name;
  return { res, name, mimeType: exp?.mime ?? item.mimeType };
}

// ---------- Subida ----------

// Abre una sesión de subida reanudable en `folderId` y devuelve su URL. El
// navegador sube el archivo directo ahí (PUT): la URL solo sirve para ese
// archivo en esa carpeta. `origin` habilita el CORS de Google para esa URL.
export async function createUploadSession({
  folderId,
  name,
  mimeType,
  size,
  origin,
  uploadedBy,
}: {
  folderId: string;
  name: string;
  mimeType: string;
  size: number;
  origin: string;
  uploadedBy: string;
}) {
  const res = await driveFetch(`${UPLOAD_API}/files?${q({ uploadType: "resumable", fields: "id" })}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": mimeType || "application/octet-stream",
      "X-Upload-Content-Length": String(size),
      Origin: origin,
    },
    body: JSON.stringify({
      name,
      parents: [folderId],
      // Todo se sube como GOOGLE_DRIVE_USER: acá queda quién fue.
      description: `Subido desde la intranet por ${uploadedBy}`,
    }),
  });
  const url = res.headers.get("location");
  if (!url) throw new DriveError("Google Drive no devolvió la dirección de subida.");
  return url;
}

export const driveErrorMessage = (e: unknown) => (e instanceof Error ? e.message : "No se pudo leer Google Drive.");
