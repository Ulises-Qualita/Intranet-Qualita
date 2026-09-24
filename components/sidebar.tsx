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
  { href: "/agente", label: "Agente Q", icon: "sparkles", area: null },
  { href: "/foro", label: "Foro", icon: "chat", area: null },
  { href: "/admin", label: "Administración", icon: "settings", area: "admin" },
];

// Solo las vistas de consulta del cliente. Editar se entra desde la tabla de
// /clientes: es una acción de gestión, no una solapa que se mire a diario.
const CLIENT_NAV: { suffix: string; label: string; area: AreaKey }[] = [
  { suffix: "", label: "Vista general", area: "clientes" },
  { suffix: "/meta", label: "META", area: "meta" },
  { suffix: "/crm", label: "CRM", area: "crm" },
  // Sin área propia: analítica del sitio, para quien ya ve el panel del cliente.
  { suffix: "/web", label: "WEB", area: "clientes" },
  { suffix: "/tareas", label: "Tareas", area: "tareas" },
  { suffix: "/portal", label: "Portal del cliente", area: "clientes" },
];

export function Sidebar({
  user,
  access,
  clients,
  openTasksByClient,
}: {
  user: SessionUser;
  access: Record<AreaKey, boolean>;
  clients: Client[];
  openTasksByClient: Record<string, number>;
}) {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      {/* Solo esta parte scrollea: el pie con el usuario queda siempre a la vista. */}
      <div className="side-scroll">
        <div className="brand">
          {/* Ambos logos se renderizan y el CSS muestra el del tema activo (sin flash al hidratar). */}
          <Image className="logo logo-light" src="/qualita-logo-navy.svg" alt="Qualita" width={112} height={46} unoptimized priority />
          <Image className="logo logo-dark" src="/qualita-logo-blanco.svg" alt="Qualita" width={112} height={46} unoptimized priority />
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
                <div key={c.id}>
                  <Link href={base} className={`client-btn${selected ? " sel" : ""}`}>
                    <ClientAvatar client={c} />
                    <span className="cn">{c.name}</span>
                    <Icon name="chevron" size={15} strokeWidth={2} className="chev" />
                  </Link>
                  {/* El div interno es el que recorta: la animación va por la fila del grid. */}
                  <div className={`subnav${selected ? " open" : ""}`}>
                    <div className="subnav-in">
                      {CLIENT_NAV.filter((item) => access[item.area]).map((item) => (
                        <Link
                          key={item.suffix}
                          href={base + item.suffix}
                          className={`sb${pathname === base + item.suffix ? " active" : ""}`}
                          tabIndex={selected ? undefined : -1}
                        >
                          <span className="ln">·</span>
                          {item.label}
                          {item.suffix === "/tareas" && openTasksByClient[c.id] > 0 && (
                            <span className="sb-badge">{openTasksByClient[c.id]}</span>
                          )}
                        </Link>
                      ))}
                    </div>
                  </div>
                </div>
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
