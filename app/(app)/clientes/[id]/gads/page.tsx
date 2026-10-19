import { notFound } from "next/navigation";
import { NoAccess } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { getClient } from "@/lib/data";
import { readPeriod } from "@/lib/period";
import { GadsView } from "./gads-view";

// Google Ads (panel del equipo; la cuenta del cliente tiene /mi-empresa/gads). Usa el período del encabezado del cliente
// (?mes= / ?desde=&hasta=), como META y CRM: por eso no lleva loading.tsx.
export default async function ClienteGadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mes?: string; dias?: string; desde?: string; hasta?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  // Misma área que META: es la publicidad del cliente.
  const [session, client] = await Promise.all([getAreaSession("meta"), getClient(id)]);
  if (!session) return <NoAccess />;
  if (!client) notFound();

  return <GadsView c={client} range={readPeriod(query)} base={`/clientes/${client.slug}`} internal />;
}
