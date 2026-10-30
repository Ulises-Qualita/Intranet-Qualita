// Quién está pidiendo algo de Drive y cuál es la carpeta raíz que le corresponde.
// Solo server. Lo usan las solapas Drive y Guías, la descarga y la subida: todo lo
// que toca Drive pasa por acá antes de validar que el archivo esté dentro de la raíz.
import { getAreaSession } from "./auth";
import { isTabHidden } from "./client-tabs";
import { getClientZone } from "./client-zone";
import { type Client, getClient } from "./data";
import { driveConfigured, isDriveId } from "./drive";

// De qué carpeta del cliente se habla: la de archivos (Drive) o la de videos
// tutoriales (Guías), que es una carpeta elegida dentro de la de Drive. Cada una
// es su solapa, con la misma clave.
export type DriveSource = "drive" | "guias";

export const isDriveSource = (value: unknown): value is DriveSource => value === "drive" || value === "guias";

export type DriveAccess = {
  client: Client;
  rootId: string;
  // true = alguien del equipo; false = la cuenta del propio cliente.
  internal: boolean;
  // Mail de quien sube, para dejarlo en la descripción del archivo.
  who: string;
};

// La cuenta de un cliente solo llega a su propia empresa (el slug que mande se
// ignora). El equipo necesita el slug y pasa por la RLS de intranet_clients.
export async function getDriveAccess(slug: string | null, source: DriveSource = "drive"): Promise<DriveAccess | null> {
  if (!driveConfigured()) return null;

  const zone = await getClientZone();
  if (zone) {
    const { client } = zone;
    if (isTabHidden(client.hiddenTabs, "client", source)) return null;
    return rootOf(client, source, false, zone.session.email);
  }

  if (!slug) return null;
  const [session, client] = await Promise.all([getAreaSession("clientes"), getClient(slug)]);
  if (!session || !client) return null;
  return rootOf(client, source, true, session.user.email);
}

// Raíz de cada solapa: la carpeta de Drive vinculada, o la de guías (que solo vale
// mientras Drive siga vinculado; al cambiarlo se borra, ver connectDriveFolder).
export function sourceRoot(client: Client, source: DriveSource): string | null {
  const { connected, accountRef } = client.integrations.drive;
  if (!connected || !isDriveId(accountRef)) return null;
  if (source === "drive") return accountRef;
  return isDriveId(client.guidesFolder) ? client.guidesFolder : null;
}

function rootOf(client: Client, source: DriveSource, internal: boolean, who: string): DriveAccess | null {
  const rootId = sourceRoot(client, source);
  return rootId ? { client, rootId, internal, who } : null;
}
