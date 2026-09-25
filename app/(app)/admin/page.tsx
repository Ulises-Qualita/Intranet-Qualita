import Link from "next/link";
import { Topbar } from "@/components/topbar";
import { NoAccess } from "@/components/ui";
import { getAgentUsage } from "@/lib/agent/usage";
import { getAreaSession } from "@/lib/auth";
import { getClientAccounts, getClients, getTeam } from "@/lib/data";
import { AgentUsageCards } from "./agent-usage";
import { ClientAccounts } from "./client-accounts";
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

  // Las cuentas de clientes se administran solo como admin (el área "admin" sola no alcanza).
  const isAdmin = session.profile?.role === "admin";
  const [members, usage, clients, accounts] = await Promise.all([
    getTeam(),
    getAgentUsage(),
    isAdmin ? getClients() : [],
    isAdmin ? getClientAccounts() : null,
  ]);

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
        <UsersAdmin members={members} currentUserId={session.user.id} canEdit={isAdmin} />
        {isAdmin && <ClientAccounts clients={clients} accounts={accounts} />}
        <AgentUsageCards usage={usage} members={members} />
      </section>
    </>
  );
}
