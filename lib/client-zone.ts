// Zona de las cuentas de clientes (/mi-empresa). Solo server.
import { cache } from "react";
import { type ClientSession, getClientSession } from "./auth";
import { calendarConfigured } from "./calendar";
import { driveConfigured } from "./drive";
import { isTabHidden, type TabKey } from "./client-tabs";
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

// Además, el equipo puede desactivar cualquiera (menos Vista general) desde
// "Editar cliente"; esas no aparecen aunque la integración esté conectada.
export function clientTabs(client: Client) {
  const tabs: { href: string; label: string; show: boolean; tab?: TabKey }[] = [
    { href: CLIENT_BASE, label: "Vista general", show: true },
    { href: `${CLIENT_BASE}/meta`, label: "META", show: client.conn.meta, tab: "meta" },
    { href: `${CLIENT_BASE}/crm`, label: "CRM", show: client.conn.crm, tab: "crm" },
    { href: `${CLIENT_BASE}/web`, label: "WEB", show: client.conn.clarity, tab: "web" },
    { href: `${CLIENT_BASE}/portal`, label: "Portal del cliente", show: client.conn.notion, tab: "portal" },
    { href: `${CLIENT_BASE}/reuniones`, label: "Reuniones", show: calendarConfigured(), tab: "reuniones" },
    { href: `${CLIENT_BASE}/drive`, label: "Drive", show: client.conn.drive && driveConfigured(), tab: "drive" },
    // Siempre visible: si no hay nadie asignado, la vista lo dice.
    { href: `${CLIENT_BASE}/equipo`, label: "Equipo", show: true, tab: "equipo" },
  ];
  return tabs
    .filter((t) => t.show && !(t.tab && isTabHidden(client.hiddenTabs, "client", t.tab)))
    .map(({ href, label }) => ({ href, label }));
}
