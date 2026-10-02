import { NoAccess } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { getClientAccounts, getClients } from "@/lib/data";
import { ClientAccounts } from "../../client-accounts";

export default async function AdminCuentasPage() {
  const session = await getAreaSession("admin");
  // Las cuentas de clientes se administran solo como admin (el área "admin" sola no alcanza).
  if (!session || session.profile?.role !== "admin") return <NoAccess />;

  const [clients, accounts] = await Promise.all([getClients(), getClientAccounts()]);

  return (
    <section className="view">
      <ClientAccounts clients={clients} accounts={accounts} />
    </section>
  );
}
