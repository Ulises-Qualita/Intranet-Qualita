import Link from "next/link";
import { notFound } from "next/navigation";
import { NoAccess } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { getClient, getTeam } from "@/lib/data";
import { AssigneesPicker } from "./assignees-picker";
import { ClientEditForm } from "./client-edit-form";
import { LogoUploader } from "./logo-uploader";
import { TabsPicker } from "./tabs-picker";

export default async function EditarClientePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getAreaSession("clientes");
  if (!session) {
    return (
      <>
        <NoAccess />
      </>
    );
  }

  const [client, team] = await Promise.all([getClient(id), getTeam()]);
  if (!client) notFound();

  const activeTeam = team.filter((m) => m.active);

  return (
    <>
      <section className="view">
        <p className="back-link">
          <Link href="/clientes">← Volver a clientes</Link>
        </p>
        <div className="grid g-2-1">
          <div className="grid">
            <ClientEditForm client={client} />
            <AssigneesPicker clientId={client.id} team={activeTeam} assigneeIds={client.assigneeIds} />
          </div>
          <div className="grid">
            <LogoUploader client={client} />
            <TabsPicker clientId={client.id} hiddenTabs={client.hiddenTabs} />
          </div>
        </div>
      </section>
    </>
  );
}
