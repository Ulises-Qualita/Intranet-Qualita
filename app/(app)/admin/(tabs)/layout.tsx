import { Topbar } from "@/components/topbar";
import { getAreaSession } from "@/lib/auth";
import { type AdminTab, AdminTabs } from "./admin-tabs";

// Administración en solapas, como el panel de un cliente: el encabezado y la barra
// son de este layout y no se desmontan al navegar; solo cambia lo de abajo. Por eso
// las páginas de este grupo no dibujan Topbar y el loading.tsx usa TabSkeleton.
// /admin/notion queda fuera del grupo: es una pantalla de configuración aparte.
// Cada página sigue validando su acceso; esto solo arma la navegación.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getAreaSession("admin");
  if (!session) {
    return (
      <>
        <Topbar crumb="Qualita" title="Administración" />
        {children}
      </>
    );
  }

  // Las cuentas de clientes se administran solo como admin (el área "admin" sola no alcanza).
  const isAdmin = session.profile?.role === "admin";
  const tabs: AdminTab[] = [
    { href: "/admin", label: "Usuarios y accesos" },
    ...(isAdmin ? [{ href: "/admin/cuentas", label: "Cuentas de clientes" }] : []),
    { href: "/admin/gastos", label: "Gastos" },
  ];

  return (
    <div className="client-shell">
      <div className="client-head">
        <Topbar crumb="Qualita" title="Administración" />
        <AdminTabs tabs={tabs} />
      </div>
      <div className="client-content">{children}</div>
    </div>
  );
}
