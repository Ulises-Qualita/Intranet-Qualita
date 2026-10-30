import { GuiasView } from "@/app/(app)/clientes/[id]/guias/guias-view";
import { CLIENT_BASE, getClientZone } from "@/lib/client-zone";

export default async function MiEmpresaGuiasPage({ searchParams }: { searchParams: Promise<{ carpeta?: string }> }) {
  const [zone, { carpeta }] = await Promise.all([getClientZone(), searchParams]);
  if (!zone) return null;
  return <GuiasView client={zone.client} base={CLIENT_BASE} internal={false} folder={carpeta} />;
}
