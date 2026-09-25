"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/app/auth/actions";
import type { Client } from "@/lib/data";
import { ClientAvatar } from "./client-avatar";
import { Icon, type IconName } from "./icons";

const TAB_ICONS: Record<string, IconName> = {
  "Vista general": "home",
  META: "bolt",
  CRM: "funnel",
  WEB: "eye",
  Portal: "media",
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
        <div className="brand">
          {/* Ambos logos se renderizan y el CSS muestra el del tema activo (sin flash al hidratar). */}
          <Image className="logo logo-light" src="/Logo-nuevo.png" alt="Qualita" width={130} height={34} unoptimized priority />
          <Image className="logo logo-dark" src="/qualita-logo-blanco.svg" alt="Qualita" width={112} height={46} unoptimized priority />
        </div>

        <div className="client-zone-head">
          <ClientAvatar client={client} />
          <div>
            <b>{client.name}</b>
            {client.sector && <span>{client.sector}</span>}
          </div>
        </div>

        {tabs.map((t) => (
          <Link key={t.href} href={t.href} className={`nav-btn${pathname === t.href ? " active" : ""}`}>
            <Icon name={TAB_ICONS[t.label] ?? "media"} />
            {t.label}
          </Link>
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
