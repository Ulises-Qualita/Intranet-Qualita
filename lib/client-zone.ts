// Zona de las cuentas de clientes (/mi-empresa). Solo server.
import { cache } from "react";
import { type ClientSession, getClientSession } from "./auth";
import { type Client, getAllClients } from "./data";

export type ClientZone = { session: ClientSession; client: Client };

// Cuenta activa + su empresa, memorizado por request: lo usan el layout y cada
// página (se renderizan en paralelo, así que cada una valida por su cuenta).
// getAllClients lee con la sesión: la RLS le devuelve solo su empresa.
export const getClientZone = cache(async (): Promise<ClientZone | null> => {
  const session = await getClientSession();
  if (!session?.active) return null;
  const client = (await getAllClients()).find((c) => c.id === session.clientId);
  return client ? { session, client } : null;
});

// Pestañas que ve el cliente: solo las de integraciones conectadas, así no
// aparecen pantallas vacías que dependen de algo que configura el equipo.
export const CLIENT_BASE = "/mi-empresa";

export function clientTabs(client: Client) {
  return [
    { href: CLIENT_BASE, label: "Vista general", show: true },
    { href: `${CLIENT_BASE}/meta`, label: "META", show: client.conn.meta },
    { href: `${CLIENT_BASE}/crm`, label: "CRM", show: client.conn.crm },
    { href: `${CLIENT_BASE}/web`, label: "WEB", show: client.conn.clarity },
    { href: `${CLIENT_BASE}/portal`, label: "Portal", show: client.conn.notion },
  ]
    .filter((t) => t.show)
    .map(({ href, label }) => ({ href, label }));
}
