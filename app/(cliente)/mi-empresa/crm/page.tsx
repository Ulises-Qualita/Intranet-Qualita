import { CrmView } from "@/app/(app)/clientes/[id]/crm/crm-view";
import { CLIENT_BASE, getClientZone } from "@/lib/client-zone";
import { readPeriod } from "@/lib/period";

export default async function MiEmpresaCrmPage({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string; desde?: string; hasta?: string }>;
}) {
  const [zone, query] = await Promise.all([getClientZone(), searchParams]);
  if (!zone) return null;
  // El cliente ve todo lo de su empresa, Meta incluido: la card de videos entra.
  return <CrmView c={zone.client} range={readPeriod(query)} base={CLIENT_BASE} internal={false} seesMeta />;
}
