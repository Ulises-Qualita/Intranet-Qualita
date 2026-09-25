import { notFound } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { NoAccess } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { getClient } from "@/lib/data";
import { readPeriod } from "@/lib/period";
import { OverviewView } from "./overview-view";

export default async function ClienteGeneralPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ dias?: string; desde?: string; hasta?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  // En paralelo: getClient lee con la sesión del usuario (RLS), sin acceso no trae nada.
  const [session, c] = await Promise.all([getAreaSession("clientes"), getClient(id)]);
  if (!session) {
    return (
      <>
        <Topbar crumb="Clientes" title="Vista general" />
        <NoAccess />
      </>
    );
  }
  if (!c) notFound();

  // El período (el mismo selector que META y CRM) recorta toda la vista.
  return <OverviewView c={c} range={readPeriod(query)} base={`/clientes/${c.slug}`} internal />;
}
