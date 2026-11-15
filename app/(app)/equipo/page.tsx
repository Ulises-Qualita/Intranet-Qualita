import { redirect } from "next/navigation";
import { OnlineCount } from "@/components/presence";
import { Topbar } from "@/components/topbar";
import { NoAccess } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { canAccess } from "@/lib/auth-shared";
import { getInternalClient } from "@/lib/data";
import { StudioTeam } from "./studio-team";

// El equipo del estudio vive en la solapa Equipo del panel interno de Qualita
// (pedido del usuario); esta ruta manda ahí. Si ese panel no existe o quien entra
// no lo ve (no lo tiene asignado), se sigue mostrando acá.
export default async function EquipoPage() {
  const session = await getAreaSession("equipo");
  if (!session) {
    return (
      <>
        <Topbar crumb="Qualita" title="Equipo" />
        <NoAccess />
      </>
    );
  }
  const studio = canAccess(session.profile, "clientes") ? await getInternalClient() : null;
  if (studio) redirect(`/clientes/${studio.slug}/equipo`);

  return (
    <>
      <Topbar crumb="Qualita" title="Equipo">
        <OnlineCount />
      </Topbar>
      <StudioTeam />
    </>
  );
}
