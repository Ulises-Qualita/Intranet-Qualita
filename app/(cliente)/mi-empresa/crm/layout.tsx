import { ClientTabGate } from "@/components/tab-gate";

// Se desactiva por cliente en "Editar cliente" → Solapas (del lado del equipo).
export default function Layout({ children }: { children: React.ReactNode }) {
  return <ClientTabGate tab="crm">{children}</ClientTabGate>;
}
