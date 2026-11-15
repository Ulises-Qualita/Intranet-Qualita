import { notFound } from "next/navigation";
import { NoAccess } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { canAccess } from "@/lib/auth-shared";
import { getClient } from "@/lib/data";
import { StudioTeam } from "../../../equipo/studio-team";
import { EquipoView } from "./equipo-view";

export default async function ClienteEquipoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Sin área propia: quien ve el panel del cliente ve también quién lo atiende.
  // En paralelo: getClient lee con la sesión del usuario (RLS), sin acceso no trae nada.
  const [session, client] = await Promise.all([getAreaSession("clientes"), getClient(id)]);
  if (!session) {
    return (
      <>
        <NoAccess />
      </>
    );
  }
  if (!client) notFound();
  // Panel interno de Qualita: acá va el equipo del estudio entero (la pantalla
  // Equipo de antes), con su misma área.
  if (client.internal) return canAccess(session.profile, "equipo") ? <StudioTeam count /> : <NoAccess />;

  return <EquipoView client={client} internal />;
}
