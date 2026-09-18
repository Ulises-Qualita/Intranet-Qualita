"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import { refreshNotion } from "../../actions";

// Descarta el cache de 60s y vuelve a leer Notion ahora.
export function RefreshNotionButton() {
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
            const result = await refreshNotion();
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
