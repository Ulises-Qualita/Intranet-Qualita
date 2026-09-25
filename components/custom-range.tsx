"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { todayISO } from "@/lib/format";
import type { Period } from "@/lib/period";
import { Icon } from "./icons";

// Por defecto el calendario nativo solo se abre desde su iconito: así se abre
// con un click en cualquier parte del campo. showPicker puede tirar (navegador
// viejo, o si no viene de un gesto del usuario); ahí queda el comportamiento normal.
function openPicker(e: React.MouseEvent<HTMLInputElement>) {
  try {
    e.currentTarget.showPicker?.();
  } catch {}
}

// Rango elegido a mano: dos calendarios (el selector de fecha nativo del
// navegador) y "Aplicar", que lleva el rango a la URL como ?desde=&hasta=.
export function CustomRange({ basePath, period }: { basePath: string; period: Period }) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(period.since);
  const [to, setTo] = useState(period.until);
  const active = period.days === null;
  const today = todayISO();

  // Se cierra con Escape o con un click afuera.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  function toggle() {
    // Al abrir, arranca desde el período que se está mirando.
    if (!open) {
      setFrom(period.since);
      setTo(period.until);
    }
    setOpen((v) => !v);
  }

  function apply(e: React.FormEvent) {
    e.preventDefault();
    if (!from || !to) return;
    const [since, until] = from <= to ? [from, to] : [to, from];
    setOpen(false);
    router.push(`${basePath}?desde=${since}&hasta=${until}`);
  }

  return (
    <div className="range-custom" ref={ref}>
      <button type="button" className={active ? "on" : undefined} aria-expanded={open} onClick={toggle}>
        <Icon name="calendar" size={14} strokeWidth={2} />
        {active ? period.label.replace(/^del /, "") : "Personalizado"}
      </button>

      {open && (
        <form className="range-pop" onSubmit={apply} aria-label="Elegir período">
          <label>
            Desde
            <input
              type="date"
              value={from}
              max={to || today}
              onChange={(e) => setFrom(e.target.value)}
              onClick={openPicker}
              required
            />
          </label>
          <label>
            Hasta
            <input
              type="date"
              value={to}
              min={from}
              max={today}
              onChange={(e) => setTo(e.target.value)}
              onClick={openPicker}
              required
            />
          </label>
          <button type="submit" className="connect-btn">
            Aplicar
          </button>
        </form>
      )}
    </div>
  );
}
