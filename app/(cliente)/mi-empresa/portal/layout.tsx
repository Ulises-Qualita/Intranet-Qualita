import { redirect } from "next/navigation";
import { ClientTabGate } from "@/components/tab-gate";
import { CLIENT_BASE, getClientZone } from "@/lib/client-zone";

// Se desactiva por cliente en "Editar cliente" → Solapas (del lado del equipo).
// Sin Notion conectado la solapa tampoco aparece: como el cliente entra por acá
// (pedido), en ese caso va a Vista general.
export default async function Layout({ children }: { children: React.ReactNode }) {
  const zone = await getClientZone();
  if (zone && !zone.client.conn.notion) redirect(CLIENT_BASE);
  return <ClientTabGate tab="portal">{children}</ClientTabGate>;
}
