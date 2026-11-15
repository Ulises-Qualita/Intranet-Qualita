import { notFound } from "next/navigation";
import { NoAccess } from "@/components/ui";
import { WorkInProgress } from "@/components/work-in-progress";
import { getAreaSession } from "@/lib/auth";
import { getClient } from "@/lib/data";

// Solapa propia del panel interno de Qualita (lib/client-nav.ts). Todavía no
// tiene contenido: muestra el cartel de "en proceso".
export default async function CerebrosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [session, client] = await Promise.all([getAreaSession("clientes"), getClient(id)]);
  if (!session) return <NoAccess />;
  if (!client?.internal) notFound();
  return <WorkInProgress title="Cerebros" />;
}
