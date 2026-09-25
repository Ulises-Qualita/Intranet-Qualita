import { notFound } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { NoAccess } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { canAccess } from "@/lib/auth-shared";
import { getClient } from "@/lib/data";
import { readPeriod } from "@/lib/period";
import { CrmView } from "./crm-view";

export default async function ClienteCrmPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ dias?: string; desde?: string; hasta?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  // En paralelo: getClient lee con la sesión del usuario (RLS), sin acceso no trae nada.
  const [session, c] = await Promise.all([getAreaSession("crm"), getClient(id)]);
  if (!session) {
    return (
      <>
        <Topbar crumb="Clientes" title="CRM y ventas" />
        <NoAccess />
      </>
    );
  }
  if (!c) notFound();

  return (
    <CrmView
      c={c}
      range={readPeriod(query)}
      base={`/clientes/${c.slug}`}
      internal
      seesMeta={canAccess(session.profile, "meta")}
    />
  );
}
