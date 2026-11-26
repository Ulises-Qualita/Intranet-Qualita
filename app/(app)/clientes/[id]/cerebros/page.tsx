import { notFound } from "next/navigation";
import { NoAccess } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { BRAIN_AREAS } from "@/lib/brains";
import { getClient } from "@/lib/data";
import { BrainMap } from "./brain-map";

// Solapa Cerebros del panel interno de Qualita (lib/client-nav.ts): un cerebro por
// área del equipo (lib/brains.ts). Por ahora es la interfaz: todavía no hay tabla
// de fuentes, así que cada área figura sin información cargada. Sin título ni
// resumen arriba (pedido): el mapa habla solo.
export default async function CerebrosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [session, client] = await Promise.all([getAreaSession("clientes"), getClient(id)]);
  if (!session) return <NoAccess />;
  if (!client?.internal) notFound();

  return (
    <section className="view brains-view">
      <BrainMap areas={BRAIN_AREAS.map((area) => ({ area, sources: 0 }))} base={`/clientes/${client.slug}/cerebros`} />
    </section>
  );
}
