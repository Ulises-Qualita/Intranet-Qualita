import { TeamTabGate } from "@/components/tab-gate";

// Se desactiva por cliente en "Editar cliente" → Solapas. Solo del equipo.
export default async function Layout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <TeamTabGate slug={id} tab="seo">
      {children}
    </TeamTabGate>
  );
}
