import Link from "next/link";
import { Topbar } from "@/components/topbar";
import { NoAccess } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { getTeam } from "@/lib/data";
import { UsersAdmin } from "./users-admin";

export default async function AdminPage() {
  const session = await getAreaSession("admin");
  if (!session) {
    return (
      <>
        <Topbar crumb="Qualita" title="Administración" />
        <NoAccess />
      </>
    );
  }

  const members = await getTeam();

  return (
    <>
      <Topbar crumb="Qualita" title="Administración" />
      <section className="view">
        <div className="view-actions">
          <span className="muted">Accesos del equipo y conexiones del estudio.</span>
          <Link href="/admin/notion" className="link-connect">
            Configurar Notion →
          </Link>
        </div>
        <UsersAdmin members={members} currentUserId={session.user.id} canEdit={session.profile?.role === "admin"} />
      </section>
    </>
  );
}
