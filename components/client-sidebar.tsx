"use client";

import { usePathname } from "next/navigation";
import { signOut } from "@/app/auth/actions";
import type { Client } from "@/lib/data";
import { ClientAvatar } from "./client-avatar";
import { Icon, type IconName } from "./icons";
import { NavLink } from "./nav-link";

const TAB_ICONS: Record<string, IconName> = {
  "Vista general": "home",
  META: "bolt",
  CRM: "funnel",
  WEB: "eye",
  "Portal del cliente": "media",
  Reuniones: "calendar",
  Drive: "folder",
  Equipo: "team",
};

// Sidebar de la cuenta de un cliente (/mi-empresa): su empresa y sus pestañas,
// sin nada del estudio. Las pestañas llegan armadas del layout (clientTabs).
export function ClientSidebar({
  client,
  email,
  tabs,
}: {
  client: Pick<Client, "name" | "initials" | "logoUrl" | "sector">;
  email: string;
  tabs: { href: string; label: string }[];
}) {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <div className="side-scroll">
        {/* Sin el logo de Qualita: acá la marca que se ve es la del cliente. */}
        <div className="client-zone-head">
          <ClientAvatar client={client} />
          <div>
            <b>{client.name}</b>
            {client.sector && <span>{client.sector}</span>}
          </div>
        </div>

        {tabs.map((t) => (
          <NavLink key={t.href} href={t.href} className={`nav-btn${pathname === t.href ? " active" : ""}`}>
            <Icon name={TAB_ICONS[t.label] ?? "media"} />
            {t.label}
          </NavLink>
        ))}
      </div>

      <div className="side-bottom">
        <div className="side-foot">
          <div className="who">
            <b>Tu cuenta</b>
            <span>{email}</span>
          </div>
          <form action={signOut} className="logout-form">
            <button type="submit" className="logout" title="Salir" aria-label="Salir">
              <Icon name="logout" size={17} strokeWidth={1.9} />
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
