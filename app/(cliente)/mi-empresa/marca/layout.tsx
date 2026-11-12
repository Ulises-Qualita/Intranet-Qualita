import { ClientTabGate } from "@/components/tab-gate";

// Arranca apagada para la cuenta del cliente: el equipo la prende en "Editar
// cliente" → Solapas (lib/client-tabs.ts → CLIENT_DEFAULT_OFF).
export default function Layout({ children }: { children: React.ReactNode }) {
  return <ClientTabGate tab="marca">{children}</ClientTabGate>;
}
