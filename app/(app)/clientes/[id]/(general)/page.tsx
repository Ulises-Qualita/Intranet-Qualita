import { notFound, redirect } from "next/navigation";
import { NoAccess } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { teamNav } from "@/lib/client-nav";
import { getClient } from "@/lib/data";
import { readPeriod } from "@/lib/period";
import { OverviewView } from "../overview-view";

export default async function ClienteGeneralPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mes?: string; dias?: string; desde?: string; hasta?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  // En paralelo: getClient lee con la sesión del usuario (RLS), sin acceso no trae nada.
  const [session, c] = await Promise.all([getAreaSession("clientes"), getClient(id)]);
  if (!session) {
    return (
      <>
        <NoAccess />
      </>
    );
  }
  if (!c) notFound();
  // El panel interno de Qualita no tiene Vista general: abre en su primera solapa.
  if (c.internal) {
    const first = teamNav(c, session.profile)[0];
    if (!first) return <NoAccess />;
    redirect(`/clientes/${c.slug}${first.suffix}`);
  }

  // El período (el mismo selector que META y CRM) recorta toda la vista.
  return <OverviewView c={c} range={readPeriod(query)} base={`/clientes/${c.slug}`} internal />;
}
