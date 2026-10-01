// Quién está pidiendo algo de Drive y cuál es la carpeta raíz que le corresponde.
// Solo server. Lo usan la solapa, la descarga y la subida: todo lo que toca
// Drive pasa por acá antes de validar que el archivo esté dentro de la raíz.
import { getAreaSession } from "./auth";
import { isTabHidden } from "./client-tabs";
import { getClientZone } from "./client-zone";
import { type Client, getClient } from "./data";
import { driveConfigured, isDriveId } from "./drive";

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
export async function getDriveAccess(slug: string | null): Promise<DriveAccess | null> {
  if (!driveConfigured()) return null;

  const zone = await getClientZone();
  if (zone) {
    const { client } = zone;
    if (isTabHidden(client.hiddenTabs, "client", "drive")) return null;
    return rootOf(client, false, zone.session.email);
  }

  if (!slug) return null;
  const [session, client] = await Promise.all([getAreaSession("clientes"), getClient(slug)]);
  if (!session || !client) return null;
  return rootOf(client, true, session.user.email);
}

function rootOf(client: Client, internal: boolean, who: string): DriveAccess | null {
  const { connected, accountRef } = client.integrations.drive;
  if (!connected || !isDriveId(accountRef)) return null;
  return { client, rootId: accountRef, internal, who };
}
