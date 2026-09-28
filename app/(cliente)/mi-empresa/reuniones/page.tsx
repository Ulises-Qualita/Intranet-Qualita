import { ReunionesView } from "@/app/(app)/clientes/[id]/reuniones/reuniones-view";
import { getClientZone } from "@/lib/client-zone";

export default async function MiEmpresaReunionesPage() {
  const zone = await getClientZone();
  if (!zone) return null;
  return <ReunionesView client={zone.client} internal={false} />;
}
