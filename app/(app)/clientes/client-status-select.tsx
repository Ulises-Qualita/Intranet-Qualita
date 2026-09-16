"use client";

import { useOptimistic, useState, useTransition } from "react";
import { CLIENT_STATUSES, type ClientStatus } from "@/lib/client-status";
import { setClientStatus } from "./actions";

export function ClientStatusSelect({ clientId, status, name }: { clientId: string; status: ClientStatus; name: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [current, setOptimistic] = useOptimistic(status);

  return (
    <div className="status-cell">
      <select
        className={`role-sel status-sel status-${current}`}
        value={current}
        aria-label={`Estado de ${name}`}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value as ClientStatus;
          setError(null);
          startTransition(async () => {
            setOptimistic(next);
            const result = await setClientStatus(clientId, next);
            if (!result.ok) setError(result.error);
          });
        }}
      >
        {CLIENT_STATUSES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      {error && <span className="form-error">{error}</span>}
    </div>
  );
}
