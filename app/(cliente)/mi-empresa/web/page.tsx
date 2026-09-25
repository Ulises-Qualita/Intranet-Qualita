import { WebView } from "@/app/(app)/clientes/[id]/web/web-view";
import { CLIENT_BASE, getClientZone } from "@/lib/client-zone";

export default async function MiEmpresaWebPage() {
  const zone = await getClientZone();
  if (!zone) return null;
  return <WebView client={zone.client} base={CLIENT_BASE} internal={false} />;
}
