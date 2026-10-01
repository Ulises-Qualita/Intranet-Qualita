"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/app/auth/actions";
import type { AreaKey } from "@/lib/auth-shared";
import type { SessionUser } from "@/lib/auth";
import type { Client } from "@/lib/data";
import { ClientAvatar } from "./client-avatar";
import { Icon, type IconName } from "./icons";
import { UserAvatar } from "./user-avatar";

// area null = no pertenece a un área: el agente consulta las que el usuario
// tenga, así que aparece con cualquiera habilitada.
const STUDIO_NAV: { href: string; label: string; icon: IconName; area: AreaKey | null }[] = [
  { href: "/", label: "Inicio", icon: "home", area: "inicio" },
  { href: "/clientes", label: "Clientes", icon: "briefcase", area: "clientes" },
  { href: "/equipo", label: "Equipo", icon: "team", area: "equipo" },
  { href: "/agente", label: "Agente", icon: "sparkles", area: null },
  { href: "/foro", label: "Foro", icon: "chat", area: null },
  { href: "/admin", label: "Administración", icon: "settings", area: "admin" },
];

// Las solapas de cada cliente no van acá: están arriba del contenido
// (app/(app)/clientes/[id]/layout.tsx).
export function Sidebar({
  user,
  access,
  clients,
}: {
  user: SessionUser;
  access: Record<AreaKey, boolean>;
  clients: Client[];
}) {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      {/* Solo esta parte scrollea: el pie con el usuario queda siempre a la vista. */}
      <div className="side-scroll">
        <div className="brand">
          {/* Ambos logos se renderizan y el CSS muestra el del tema activo (sin flash al hidratar). */}
          <Image className="logo logo-light" src="/Logo-nuevo.png" alt="Qualita" width={130} height={34} unoptimized priority />
          <Image className="logo logo-dark" src="/Logo-Nuevo-Blanco.png" alt="Qualita" width={130} height={34} unoptimized priority />
          <div className="brand-tag">INTRANET</div>
        </div>

        <div className="nav-title">Qualita</div>
        {STUDIO_NAV.filter((item) => (item.area ? access[item.area] : Object.values(access).some(Boolean))).map((item) => (
          <Link key={item.href} href={item.href} className={`nav-btn${pathname === item.href ? " active" : ""}`}>
            <Icon name={item.icon} />
            {item.label}
          </Link>
        ))}

        {access.clientes && (
          <>
            <div className="nav-title">Clientes</div>
            {clients.length === 0 && <div className="nav-empty">Sin clientes cargados</div>}
            {clients.map((c) => {
              const base = `/clientes/${c.slug}`;
              const selected = pathname === base || pathname.startsWith(`${base}/`);
              return (
                <Link
                  key={c.id}
                  href={base}
                  className={`client-btn${selected ? " sel" : ""}`}
                  aria-current={selected ? "page" : undefined}
                >
                  <ClientAvatar client={c} />
                  <span className="cn">{c.name}</span>
                </Link>
              );
            })}
          </>
        )}
      </div>

      <div className="side-bottom">
        <div className="side-foot">
          <UserAvatar className="fav" name={user.name} avatarUrl={user.avatarUrl} />
          <div className="who">
            <b>{user.name}</b>
            <span>{user.email}</span>
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
