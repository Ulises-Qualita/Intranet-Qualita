import { GadsView } from "@/app/(app)/clientes/[id]/gads/gads-view";
import { CLIENT_BASE, getClientZone } from "@/lib/client-zone";
import { readPeriod } from "@/lib/period";

export default async function MiEmpresaGadsPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; dias?: string; desde?: string; hasta?: string }>;
}) {
  const [zone, query] = await Promise.all([getClientZone(), searchParams]);
  if (!zone) return null;
  return <GadsView c={zone.client} range={readPeriod(query)} base={CLIENT_BASE} internal={false} />;
}
