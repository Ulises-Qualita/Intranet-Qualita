import { notFound } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { NoAccess } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { getClient } from "@/lib/data";
import { WebView } from "./web-view";

export default async function ClienteWebPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Sin área propia: quien ve el panel del cliente ve también su sitio.
  // En paralelo: getClient lee con la sesión del usuario (RLS), sin acceso no trae nada.
  const [session, client] = await Promise.all([getAreaSession("clientes"), getClient(id)]);
  if (!session) {
    return (
      <>
        <Topbar crumb="Clientes" title="WEB" />
        <NoAccess />
      </>
    );
  }
  if (!client) notFound();

  return <WebView client={client} base={`/clientes/${client.slug}`} internal />;
}
