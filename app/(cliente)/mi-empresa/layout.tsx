import Image from "next/image";
import { redirect } from "next/navigation";
import { signOut } from "@/app/auth/actions";
import { ClientSidebar } from "@/components/client-sidebar";
import { getClientSession } from "@/lib/auth";
import { clientTabs, getClientZone } from "@/lib/client-zone";
import { createClient } from "@/lib/supabase/server";

// Layout de la cuenta de un cliente: solo su empresa, sin la parte interna de
// Qualita ni el agente. proxy.ts ya encierra acá a toda sesión que no es del
// equipo; esto valida que la cuenta exista, esté activa y tenga su empresa.
export default async function ClientZoneLayout({ children }: { children: React.ReactNode }) {
  const zone = await getClientZone();

  if (!zone) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    if (!data?.claims) redirect("/login");

    const session = await getClientSession();
    return (
      <main className="login">
        <div className="login-card">
          <Image className="login-logo" src="/Logo-nuevo.png" alt="Qualita" width={145} height={38} unoptimized priority />
          <h1>Cuenta sin acceso</h1>
          <p className="sub">
            {session && !session.active
              ? "Tu cuenta está desactivada. Escribile a tu contacto en Qualita."
              : "Esta cuenta no tiene una empresa habilitada en la intranet. Escribile a tu contacto en Qualita."}
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

  return (
    <div className="shell">
      <ClientSidebar client={zone.client} email={zone.session.email} tabs={clientTabs(zone.client)} />
      <div className="main">{children}</div>
    </div>
  );
}
