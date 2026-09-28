import { notFound } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { NoAccess } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { getClient } from "@/lib/data";
import { ReunionesView } from "./reuniones-view";

export default async function ClienteReunionesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Sin área propia, como Equipo: quien ve el panel del cliente ve sus reuniones.
  const [session, client] = await Promise.all([getAreaSession("clientes"), getClient(id)]);
  if (!session) {
    return (
      <>
        <Topbar crumb="Clientes" title="Reuniones" />
        <NoAccess />
      </>
    );
  }
  if (!client) notFound();

  return <ReunionesView client={client} internal />;
}
