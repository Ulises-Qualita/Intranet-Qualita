import Link from "next/link";
import { notFound } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { NoAccess } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { getClient, getTeam } from "@/lib/data";
import { AssigneesPicker } from "./assignees-picker";
import { ClientEditForm } from "./client-edit-form";
import { LogoUploader } from "./logo-uploader";

export default async function EditarClientePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getAreaSession("clientes");
  if (!session) {
    return (
      <>
        <Topbar crumb="Clientes" title="Editar cliente" />
        <NoAccess />
      </>
    );
  }

  const [client, team] = await Promise.all([getClient(id), getTeam()]);
  if (!client) notFound();

  const activeTeam = team.filter((m) => m.active);

  return (
    <>
      <Topbar crumb={client.name} title="Editar cliente" />
      <section className="view">
        <p className="back-link">
          <Link href="/clientes">← Volver a clientes</Link>
        </p>
        <div className="grid g-2-1">
          <div className="grid">
            <ClientEditForm client={client} />
            <AssigneesPicker clientId={client.id} team={activeTeam} assigneeIds={client.assigneeIds} />
          </div>
          <LogoUploader client={client} />
        </div>
      </section>
    </>
  );
}
