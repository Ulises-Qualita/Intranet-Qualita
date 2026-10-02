"use client";

import { usePathname } from "next/navigation";
import { NavLink } from "@/components/nav-link";

export type AdminTab = { href: string; label: string };

// Solapas de Administración, con las mismas clases que las del panel de un
// cliente (components/client-tabs-bar.tsx) pero sin período ni engranaje.
export function AdminTabs({ tabs }: { tabs: AdminTab[] }) {
  const pathname = usePathname();

  return (
    <div className="client-tabbar">
      <nav className="client-tabs" aria-label="Secciones de Administración">
        {tabs.map((t) => {
          const on = pathname === t.href;
          return (
            <NavLink key={t.href} href={t.href} className={`client-tab${on ? " on" : ""}`} aria-current={on ? "page" : undefined}>
              {t.label}
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}
