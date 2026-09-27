import { notFound } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { NoAccess } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { getClient } from "@/lib/data";
import { EquipoView } from "./equipo-view";

export default async function ClienteEquipoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Sin área propia: quien ve el panel del cliente ve también quién lo atiende.
  // En paralelo: getClient lee con la sesión del usuario (RLS), sin acceso no trae nada.
  const [session, client] = await Promise.all([getAreaSession("clientes"), getClient(id)]);
  if (!session) {
    return (
      <>
        <Topbar crumb="Clientes" title="Equipo" />
        <NoAccess />
      </>
    );
  }
  if (!client) notFound();

  return <EquipoView client={client} internal />;
}
