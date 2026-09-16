import Image from "next/image";
import { redirect } from "next/navigation";
import { signOut } from "@/app/auth/actions";
import { Sidebar } from "@/components/sidebar";
import { AREAS, canAccess, type AreaKey } from "@/lib/auth-shared";
import { getSession } from "@/lib/auth";
import { getClients, getTasks, isOpenTask } from "@/lib/data";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // proxy.ts ya redirige sin sesión; esto es la segunda barrera.
  const session = await getSession();
  if (!session) redirect("/login");

  const { user, profile } = session;

  if (!profile?.active) {
    return (
      <main className="login">
        <div className="login-card">
          <Image className="login-logo" src="/qualita-logo-navy.svg" alt="Qualita" width={107} height={44} unoptimized priority />
          <h1>Cuenta sin acceso</h1>
          <p className="sub">
            {user.email} todavía no está habilitada en la intranet. Pedile a un administrador que te dé acceso.
          </p>
          <form action={signOut}>
            <button type="submit" className="logout-link">
              Salir e ingresar con otra cuenta
            </button>
          </form>
        </div>
      </main>
    );
  }

  const access = Object.fromEntries(AREAS.map(([k]) => [k, canAccess(profile, k)])) as Record<AreaKey, boolean>;
  const [clients, tasks] = await Promise.all([
    access.clientes ? getClients() : [],
    access.tareas ? getTasks() : [],
  ]);
  const openTasksByClient: Record<string, number> = {};
  for (const t of tasks.filter(isOpenTask)) openTasksByClient[t.client_id] = (openTasksByClient[t.client_id] ?? 0) + 1;

  return (
    <div className="shell">
      <Sidebar user={user} access={access} clients={clients} openTasksByClient={openTasksByClient} />
      <div className="main">{children}</div>
    </div>
  );
}
