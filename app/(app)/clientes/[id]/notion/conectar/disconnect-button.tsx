"use client";

import { useState, useTransition } from "react";
import { setIntegration } from "../../../actions";

export function DisconnectNotionButton({ clientId }: { clientId: string }) {
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
            const result = await setIntegration(clientId, "notion", { connected: false });
            if (!result.ok) setError(result.error);
          })
        }
      >
        {pending ? "Desvinculando…" : "Desvincular proyecto"}
      </button>
      {error && <p className="form-error">{error}</p>}
    </>
  );
}
