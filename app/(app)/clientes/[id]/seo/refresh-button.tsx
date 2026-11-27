"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import { refreshSearchConsole } from "../../actions";

// Lo de Search Console se guarda unas horas: esto lo vuelve a leer ahora.
export function RefreshSearchConsole() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <>
      {error && <span className="form-error">{error}</span>}
      <button
        type="button"
        className="btn-secondary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await refreshSearchConsole();
            if (result.ok) router.refresh();
            else setError(result.error);
          })
        }
      >
        <Icon name="refresh" size={15} strokeWidth={2} />
        {pending ? "Actualizando…" : "Actualizar"}
      </button>
    </>
  );
}
