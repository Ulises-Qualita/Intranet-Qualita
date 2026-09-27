import { EquipoView } from "@/app/(app)/clientes/[id]/equipo/equipo-view";
import { getClientZone } from "@/lib/client-zone";

export default async function MiEmpresaEquipoPage() {
  const zone = await getClientZone();
  if (!zone) return null;
  return <EquipoView client={zone.client} internal={false} />;
}
