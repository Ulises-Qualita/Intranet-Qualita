import { notFound } from "next/navigation";
import { ConnectState, NoAccess } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { getClient } from "@/lib/data";
import { readPeriod } from "@/lib/period";
import { GadsView } from "./gads-view";

// Google Ads, solo para el equipo. Usa el período del encabezado del cliente
// (?dias= / ?desde=&hasta=), como META y CRM: por eso no lleva loading.tsx.
export default async function ClienteGadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ dias?: string; desde?: string; hasta?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  // Misma área que META: es la publicidad del cliente.
  const [session, client] = await Promise.all([getAreaSession("meta"), getClient(id)]);
  if (!session) return <NoAccess />;
  if (!client) notFound();

  if (!client.conn.google_ads) {
    return (
      <section className="view">
        <ConnectState kind="google_ads" client={client} />
      </section>
    );
  }

  return <GadsView c={client} range={readPeriod(query)} />;
}
