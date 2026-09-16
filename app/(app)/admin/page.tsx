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
        <UsersAdmin members={members} currentUserId={session.user.id} canEdit={session.profile?.role === "admin"} />
      </section>
    </>
  );
}
