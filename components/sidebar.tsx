"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { signOut } from "@/app/auth/actions";
import type { AreaKey } from "@/lib/auth-shared";
import type { SessionUser } from "@/lib/auth";
import type { Client } from "@/lib/data";
import { ClientAvatar } from "./client-avatar";
import { Icon, type IconName } from "./icons";
import { UserAvatar } from "./user-avatar";

const STUDIO_NAV: { href: string; label: string; icon: IconName; area: AreaKey }[] = [
  { href: "/", label: "Inicio", icon: "home", area: "inicio" },
  { href: "/clientes", label: "Clientes", icon: "briefcase", area: "clientes" },
  { href: "/equipo", label: "Equipo", icon: "team", area: "equipo" },
  { href: "/admin", label: "Administración", icon: "settings", area: "admin" },
];

const CLIENT_NAV: { suffix: string; label: string; area: AreaKey }[] = [
  { suffix: "", label: "Vista general", area: "clientes" },
  { suffix: "/meta", label: "META", area: "meta" },
  { suffix: "/crm", label: "CRM", area: "crm" },
  { suffix: "/tareas", label: "Tareas", area: "tareas" },
  { suffix: "/editar", label: "Editar cliente", area: "clientes" },
];

// Tema: la clase .dark en <html> la pone el script del root layout; acá solo la leemos y alternamos.
const themeListeners = new Set<() => void>();
const subscribeTheme = (cb: () => void) => {
  themeListeners.add(cb);
  return () => themeListeners.delete(cb);
};
const isDark = () => document.documentElement.classList.contains("dark");

function toggleTheme() {
  const dark = document.documentElement.classList.toggle("dark");
  try {
    localStorage.setItem("theme", dark ? "dark" : "light");
  } catch {}
  themeListeners.forEach((cb) => cb());
}

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
  const dark = useSyncExternalStore(subscribeTheme, isDark, () => false);

  return (
    <aside className="sidebar">
      <div className="brand">
        {/* Ambos logos se renderizan y el CSS muestra el del tema activo (sin flash al hidratar). */}
        <Image className="logo logo-light" src="/qualita-logo-navy.svg" alt="Qualita" width={112} height={46} unoptimized priority />
        <Image className="logo logo-dark" src="/qualita-logo-blanco.svg" alt="Qualita" width={112} height={46} unoptimized priority />
        <div className="brand-tag">INTRANET</div>
      </div>

      <div className="nav-title">Qualita</div>
      {STUDIO_NAV.filter((item) => access[item.area]).map((item) => (
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
                <div className={`subnav${selected ? " open" : ""}`}>
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
            );
          })}
        </>
      )}

      <div className="side-bottom">
        <button type="button" className="nav-btn" onClick={toggleTheme}>
          <Icon name={dark ? "sun" : "moon"} />
          <span>{dark ? "Modo claro" : "Modo oscuro"}</span>
        </button>
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
