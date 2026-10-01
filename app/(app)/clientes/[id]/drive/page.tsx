import { notFound } from "next/navigation";
import { NoAccess } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { getClient } from "@/lib/data";
import { DriveView } from "./drive-view";

export default async function ClienteDrivePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ carpeta?: string }>;
}) {
  const [{ id }, { carpeta }] = await Promise.all([params, searchParams]);
  // Sin área propia: quien ve el panel del cliente ve también sus archivos.
  const [session, client] = await Promise.all([getAreaSession("clientes"), getClient(id)]);
  if (!session) return <NoAccess />;
  if (!client) notFound();

  return <DriveView client={client} base={`/clientes/${client.slug}`} internal folder={carpeta} />;
}
