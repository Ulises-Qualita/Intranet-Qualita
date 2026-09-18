"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import { refreshClarity } from "./actions";

// Sincronizar a mano gasta 3 de las 10 consultas diarias que Clarity permite por
// proyecto, así que el aviso va en el título del botón y no escondido.
export function RefreshClarity({ clientId }: { clientId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function refresh() {
    setError(null);
    startTransition(async () => {
      const result = await refreshClarity(clientId);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  return (
    <div className="view-actions-end">
      {error && <span className="form-error">{error}</span>}
      <button
        type="button"
        className="btn-secondary"
        onClick={refresh}
        disabled={pending}
        title="Gasta 3 de las 10 consultas diarias que Clarity permite por proyecto"
      >
        <Icon name="refresh" size={15} strokeWidth={2} />
        {pending ? "Sincronizando…" : "Actualizar"}
      </button>
    </div>
  );
}
