"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { monthShortcuts, readPeriod } from "@/lib/period";
import { CustomRange } from "./custom-range";
import { Icon } from "./icons";
import { NavLink } from "./nav-link";

// config: acción de ajustes de la solapa (p. ej. las etapas del CRM), como un
// engranaje junto al período para no ocupar lugar arriba de las cards.
export type ClientTab = { suffix: string; label: string; badge?: number; config?: { href: string; label: string } };

// El período es uno solo para todas las solapas: vive en la URL y cada solapa lo
// lleva en su link, así al pasar de CRM a META (o por una que no lo usa, como
// Reuniones) se mira el mismo corte.
function usePeriodQuery() {
  const params = useSearchParams();
  const query = new URLSearchParams();
  for (const key of ["mes", "dias", "desde", "hasta"]) {
    const value = params.get(key);
    if (value) query.set(key, value);
  }
  return query;
}

// Las pantallas de conexión (/meta/conectar…) cuentan como su solapa.
function useCurrentTab(base: string, tabs: ClientTab[]) {
  const pathname = usePathname();
  const isActive = (suffix: string) =>
    suffix ? pathname === base + suffix || pathname.startsWith(`${base}${suffix}/`) : pathname === base;
  return { pathname, current: tabs.find((t) => isActive(t.suffix)) };
}

// Solapas de un cliente en el panel del equipo, arriba del contenido. Va en el
// layout del cliente, así que no se desmonta al navegar: solo cambia lo de abajo.
export function ClientTabsBar({ base, tabs }: { base: string; tabs: ClientTab[] }) {
  const query = usePeriodQuery();
  const qs = query.toString() ? `?${query}` : "";
  const { current } = useCurrentTab(base, tabs);

  return (
    <div className="client-tabbar">
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
    </div>
  );
}

// Engranaje de la solapa y selector de período, en el encabezado del cliente (a la
// izquierda del tema): en la barra de solapas les quitaban lugar y se cortaban.
// El período solo aparece donde recorta los datos (`periodTabs`).
export function ClientPeriodBar({ base, tabs, periodTabs }: { base: string; tabs: ClientTab[]; periodTabs: string[] }) {
  const router = useRouter();
  const query = usePeriodQuery();
  const period = readPeriod(Object.fromEntries(query));
  const { pathname, current } = useCurrentTab(base, tabs);
  // Cambiar el período navega dentro de una transición: la vista anterior queda
  // (atenuada por CSS con data-pending) hasta que llegan los números nuevos, en
  // vez de pasar por el esqueleto. Para eso META, CRM y Vista general no tienen
  // un loading.tsx que se reinicie con ?mes= (ver (general)/ en el layout).
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<string | null>(null);

  const onTab = !!current && pathname === base + current.suffix;
  const showRange = onTab && periodTabs.includes(current.suffix);
  const config = onTab ? current.config : undefined;
  if (!showRange && !config) return null;

  function navigate(href: string, month: string | null = null) {
    setTarget(month);
    startTransition(() => router.push(href));
  }
  // Mientras carga, el atajo elegido ya se ve marcado.
  const shownMonth = pending ? target : (period.month ?? null);

  return (
    <div className="client-period" data-pending={pending || undefined}>
      {config && (
        <Link href={config.href} className="tab-config" title={config.label} aria-label={config.label}>
          <Icon name="settings" size={16} strokeWidth={2} />
        </Link>
      )}
      {showRange && (
        <div className="range">
          {/* Los últimos tres meses; el actual, hasta hoy. */}
          {monthShortcuts().map((m) => (
            <button
              key={m.month}
              type="button"
              className={m.month === shownMonth ? "on" : undefined}
              onClick={() => navigate(`${pathname}?mes=${m.month}`, m.month)}
            >
              {m.label}
            </button>
          ))}
          <CustomRange basePath={pathname} period={period} navigate={(href) => navigate(href)} />
        </div>
      )}
    </div>
  );
}
