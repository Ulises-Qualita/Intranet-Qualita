import { MetaView } from "@/app/(app)/clientes/[id]/meta/meta-view";
import { CLIENT_BASE, getClientZone } from "@/lib/client-zone";
import { isTabHidden } from "@/lib/client-tabs";
import { readPeriod } from "@/lib/period";

export default async function MiEmpresaMetaPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; dias?: string; desde?: string; hasta?: string; anuncio?: string }>;
}) {
  const [zone, query] = await Promise.all([getClientZone(), searchParams]);
  if (!zone) return null;
  // Las ventas por video salen del CRM: entran si el cliente tiene a la vista su solapa CRM.
  return (
    <MetaView
      c={zone.client}
      range={readPeriod(query)}
      base={CLIENT_BASE}
      internal={false}
      anuncio={query.anuncio}
      seesCrm={!isTabHidden(zone.client.hiddenTabs, "client", "crm")}
    />
  );
}
