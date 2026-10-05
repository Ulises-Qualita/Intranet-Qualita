import { notFound } from "next/navigation";
import { NoAccess } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { getClient } from "@/lib/data";
import { PortalView } from "./portal-view";

// Portal del cliente, armado en la intranet (ver portal-view.tsx).
export default async function ClientePortalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [session, c] = await Promise.all([getAreaSession("clientes"), getClient(id)]);
  if (!session) {
    return (
      <>
        <NoAccess />
      </>
    );
  }
  if (!c) notFound();

  return <PortalView c={c} internal />;
}
