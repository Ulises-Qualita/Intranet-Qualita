import Link from "next/link";
import { NoAccess } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { getTeam } from "@/lib/data";
import { UsersAdmin } from "../users-admin";

export default async function AdminPage() {
  const session = await getAreaSession("admin");
  if (!session) return <NoAccess />;

  const isAdmin = session.profile?.role === "admin";
  const members = await getTeam();

  return (
    <section className="view">
      <div className="view-actions">
        <span className="muted">Accesos del equipo y conexiones del estudio.</span>
        <Link href="/admin/notion" className="link-connect">
          Configurar Notion →
        </Link>
      </div>
      <UsersAdmin members={members} currentUserId={session.user.id} canEdit={isAdmin} />
    </section>
  );
}
