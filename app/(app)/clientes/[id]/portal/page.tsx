import { notFound } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { NoAccess } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { getClient } from "@/lib/data";
import { PortalView } from "./portal-view";

// Portal del cliente con el render propio de la intranet (ver portal-view.tsx).
export default async function ClientePortalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [session, c] = await Promise.all([getAreaSession("clientes"), getClient(id)]);
  if (!session) {
    return (
      <>
        <Topbar crumb="Clientes" title="Portal del cliente" />
        <NoAccess />
      </>
    );
  }
  if (!c) notFound();

  return <PortalView c={c} internal isAdmin={session.profile?.role === "admin"} />;
}
