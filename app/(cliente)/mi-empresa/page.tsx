import { OverviewView } from "@/app/(app)/clientes/[id]/overview-view";
import { CLIENT_BASE, getClientZone } from "@/lib/client-zone";
import { readPeriod } from "@/lib/period";

// Vista general de la empresa del cliente. Las páginas se renderizan en paralelo
// con el layout: sin cuenta válida no muestran nada (el layout ya avisa).
export default async function MiEmpresaPage({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string; desde?: string; hasta?: string }>;
}) {
  const [zone, query] = await Promise.all([getClientZone(), searchParams]);
  if (!zone) return null;
  return <OverviewView c={zone.client} range={readPeriod(query)} base={CLIENT_BASE} internal={false} />;
}
