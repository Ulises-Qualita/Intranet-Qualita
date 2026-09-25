import { PortalView } from "@/app/(app)/clientes/[id]/portal/portal-view";
import { getClientZone } from "@/lib/client-zone";

export default async function MiEmpresaPortalPage() {
  const zone = await getClientZone();
  if (!zone) return null;
  return <PortalView c={zone.client} internal={false} isAdmin={false} />;
}
