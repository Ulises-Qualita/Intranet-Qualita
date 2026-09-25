import { MetaView } from "@/app/(app)/clientes/[id]/meta/meta-view";
import { CLIENT_BASE, getClientZone } from "@/lib/client-zone";
import { readPeriod } from "@/lib/period";

export default async function MiEmpresaMetaPage({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string; desde?: string; hasta?: string; anuncio?: string }>;
}) {
  const [zone, query] = await Promise.all([getClientZone(), searchParams]);
  if (!zone) return null;
  return (
    <MetaView c={zone.client} range={readPeriod(query)} base={CLIENT_BASE} internal={false} anuncio={query.anuncio} />
  );
}
