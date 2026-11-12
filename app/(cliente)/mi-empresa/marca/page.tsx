import { BrandView } from "@/app/(app)/clientes/[id]/marca/brand-view";
import { getClientZone } from "@/lib/client-zone";

export default async function MiEmpresaMarcaPage() {
  const zone = await getClientZone();
  if (!zone) return null;
  return <BrandView c={zone.client} internal={false} />;
}
