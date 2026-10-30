import { notFound } from "next/navigation";
import { NoAccess } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { getClient } from "@/lib/data";
import { GuiasView } from "./guias-view";

export default async function ClienteGuiasPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ carpeta?: string }>;
}) {
  const [{ id }, { carpeta }] = await Promise.all([params, searchParams]);
  // Sin área propia, como Drive: quien ve el panel del cliente ve también sus guías.
  const [session, client] = await Promise.all([getAreaSession("clientes"), getClient(id)]);
  if (!session) return <NoAccess />;
  if (!client) notFound();

  return <GuiasView client={client} base={`/clientes/${client.slug}`} internal folder={carpeta} />;
}
