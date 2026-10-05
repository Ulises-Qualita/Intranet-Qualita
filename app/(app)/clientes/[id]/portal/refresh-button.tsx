"use client";

import { usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import { refreshPortal } from "../../actions";

// Descarta el cache de los tickets de Notion y de las reuniones, y los vuelve a
// leer ahora. Va en el encabezado
// del cliente (a la izquierda del tema), que es del layout y no sabe en qué solapa
// está: por eso se muestra solo en `href`, la del portal.
export function RefreshPortalButton({ href }: { href: string }) {
  const pathname = usePathname();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (pathname !== href) return null;

  // Sin lugar para un mensaje en el encabezado: el error va en el ícono (rojo) y su título.
  const label = pending ? "Actualizando…" : (error ?? "Actualizar etapas y reuniones");

  return (
    <button
      type="button"
      className={`icon-btn${pending ? " busy" : ""}${error ? " failed" : ""}`}
      disabled={pending}
      title={label}
      aria-label={label}
      onClick={() =>
        startTransition(async () => {
          setError(null);
          const result = await refreshPortal();
          if (!result.ok) setError(result.error);
        })
      }
    >
      <Icon name="refresh" size={18} strokeWidth={1.9} />
    </button>
  );
}
