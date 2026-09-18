"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import { refreshPortal } from "../../actions";

// Descarta el cache del portal y vuelve a leer Notion ahora.
export function RefreshPortalButton() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <button
        type="button"
        className="btn-secondary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await refreshPortal();
            if (!result.ok) setError(result.error);
          })
        }
      >
        <Icon name="refresh" size={15} strokeWidth={2} />
        {pending ? "Actualizando…" : "Actualizar"}
      </button>
      {error && <p className="form-error">{error}</p>}
    </>
  );
}
