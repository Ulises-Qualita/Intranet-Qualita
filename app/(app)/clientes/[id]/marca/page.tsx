import { notFound } from "next/navigation";
import { NoAccess } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { getClient } from "@/lib/data";
import { BrandView } from "./brand-view";

// Manual de marca (panel del equipo; la cuenta del cliente tiene /mi-empresa/marca,
// que arranca apagada). Sin área propia: la ve quien ve el panel del cliente.
export default async function ClienteMarcaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [session, client] = await Promise.all([getAreaSession("clientes"), getClient(id)]);
  if (!session) return <NoAccess />;
  if (!client) notFound();
  return <BrandView c={client} internal />;
}
