"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { RANGES, readPeriod } from "@/lib/period";
import { CustomRange } from "./custom-range";
import { Icon } from "./icons";
import { NavLink } from "./nav-link";

// config: acción de ajustes de la solapa (p. ej. las etapas del CRM), como un
// engranaje junto al período para no ocupar lugar arriba de las cards.
export type ClientTab = { suffix: string; label: string; badge?: number; config?: { href: string; label: string } };

// Solapas de un cliente en el panel del equipo, arriba del contenido, con el
// selector de período a la derecha. Va en el layout del cliente, así que no se
// desmonta al navegar: solo cambia lo que está debajo.
//
// El período es uno solo para todas las solapas: vive en la URL y cada solapa lo
// lleva en su link, así al pasar de CRM a META (o por una que no lo usa, como
// Reuniones) se mira el mismo corte.
export function ClientTabsBar({ base, tabs, periodTabs }: { base: string; tabs: ClientTab[]; periodTabs: string[] }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  // Cambiar el período navega dentro de una transición: la vista anterior queda
  // (atenuada por CSS con data-pending) hasta que llegan los números nuevos, en
  // vez de pasar por el esqueleto. Para eso META, CRM y Vista general no tienen
  // un loading.tsx que se reinicie con ?dias= (ver (general)/ en el layout).
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<number | null>(null);

  const query = new URLSearchParams();
  for (const key of ["dias", "desde", "hasta"]) {
    const value = params.get(key);
    if (value) query.set(key, value);
  }
  const qs = query.toString() ? `?${query}` : "";
  const period = readPeriod(Object.fromEntries(query));

  // Las pantallas de conexión (/meta/conectar…) cuentan como su solapa.
  const isActive = (suffix: string) =>
    suffix ? pathname === base + suffix || pathname.startsWith(`${base}${suffix}/`) : pathname === base;
  const current = tabs.find((t) => isActive(t.suffix));
  // Solo donde recorta los datos. En el resto el lugar queda reservado (invisible)
  // para que la barra no cambie de alto entre solapas.
  const showRange = !!current && pathname === base + current.suffix && periodTabs.includes(current.suffix);

  function navigate(href: string, days: number | null = null) {
    setTarget(days);
    startTransition(() => router.push(href));
  }
  // Mientras carga, el atajo elegido ya se ve marcado.
  const shownDays = pending ? target : period.days;

  return (
    <div className="client-tabbar" data-pending={pending || undefined}>
      <nav className="client-tabs" aria-label="Solapas del cliente">
        {tabs.map((t) => (
          <NavLink
            key={t.suffix}
            href={base + t.suffix + qs}
            className={`client-tab${t === current ? " on" : ""}`}
            aria-current={t === current ? "page" : undefined}
          >
            {t.label}
            {!!t.badge && <span className="tab-badge">{t.badge}</span>}
          </NavLink>
        ))}
      </nav>
      {current?.config && pathname === base + current.suffix && (
        <Link href={current.config.href} className="tab-config" title={current.config.label} aria-label={current.config.label}>
          <Icon name="settings" size={16} strokeWidth={2} />
        </Link>
      )}
      <div className={`client-tabbar-range${showRange ? "" : " off"}`} inert={!showRange}>
        <div className="range">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              className={r === shownDays ? "on" : undefined}
              onClick={() => navigate(`${pathname}?dias=${r}`, r)}
            >
              {r} días
            </button>
          ))}
          <CustomRange basePath={pathname} period={period} navigate={(href) => navigate(href)} />
        </div>
      </div>
    </div>
  );
}
