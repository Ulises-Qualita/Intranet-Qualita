import { notFound } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { NoAccess } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { getClient } from "@/lib/data";
import { readPeriod } from "@/lib/period";
import { MetaView } from "./meta-view";

export default async function ClienteMetaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ dias?: string; desde?: string; hasta?: string; anuncio?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  // En paralelo: getClient lee con la sesión del usuario (RLS), sin acceso no trae nada.
  const [session, c] = await Promise.all([getAreaSession("meta"), getClient(id)]);
  if (!session) {
    return (
      <>
        <Topbar crumb="Clientes" title="Métricas de META" />
        <NoAccess />
      </>
    );
  }
  if (!c) notFound();

  return <MetaView c={c} range={readPeriod(query)} base={`/clientes/${c.slug}`} internal anuncio={query.anuncio} />;
}
