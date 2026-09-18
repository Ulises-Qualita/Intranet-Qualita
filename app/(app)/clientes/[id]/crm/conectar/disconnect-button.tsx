"use client";

import { useState, useTransition } from "react";
import { setIntegration } from "../../../actions";

export function DisconnectCrmButton({ clientId }: { clientId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <button
        type="button"
        className="link-danger"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await setIntegration(clientId, "crm", { connected: false });
            if (!result.ok) setError(result.error);
          })
        }
      >
        {pending ? "Desconectando…" : "Desconectar CRM"}
      </button>
      {error && <p className="form-error">{error}</p>}
    </>
  );
}
