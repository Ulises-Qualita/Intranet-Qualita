import { DriveView } from "@/app/(app)/clientes/[id]/drive/drive-view";
import { CLIENT_BASE, getClientZone } from "@/lib/client-zone";

export default async function MiEmpresaDrivePage({ searchParams }: { searchParams: Promise<{ carpeta?: string }> }) {
  const [zone, { carpeta }] = await Promise.all([getClientZone(), searchParams]);
  if (!zone) return null;
  return <DriveView client={zone.client} base={CLIENT_BASE} internal={false} folder={carpeta} />;
}
