"use client";

import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { Icon } from "./icons";

// Menú en el celular: debajo de 820 px la sidebar sale de la pantalla y se abre
// como cajón con el botón del encabezado. El estado vive en <html data-nav="open">
// (lo lee el CSS) y se comparte entre el botón y la sidebar con este store.
const listeners = new Set<() => void>();
const isOpen = () => document.documentElement.dataset.nav === "open";

function setOpen(open: boolean) {
  if (open) document.documentElement.dataset.nav = "open";
  else delete document.documentElement.dataset.nav;
  listeners.forEach((cb) => cb());
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

function useNavOpen() {
  return useSyncExternalStore(subscribe, isOpen, () => false);
}

// Va en el encabezado (Topbar, ClientHeader); el CSS lo muestra solo en móvil.
export function NavToggle() {
  const open = useNavOpen();
  return (
    <button
      type="button"
      className="icon-btn nav-toggle"
      aria-label="Abrir menú"
      aria-expanded={open}
      onClick={() => setOpen(!open)}
    >
      <Icon name="menu" size={19} strokeWidth={2} />
    </button>
  );
}

// Va dentro de cada sidebar: el fondo oscuro para cerrar tocando afuera, y el
// cierre al navegar o con Escape.
export function NavDrawerCloser() {
  const open = useNavOpen();
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return <div className="nav-backdrop" aria-hidden onClick={() => setOpen(false)} />;
}
