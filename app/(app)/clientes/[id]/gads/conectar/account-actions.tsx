"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { connectGoogleAdsAccount, setIntegration } from "../../../actions";

export function ChooseAccountButton({
  clientId,
  clientSlug,
  customerId,
  accountName,
  current,
}: {
  clientId: string;
  clientSlug: string;
  customerId: string;
  accountName: string;
  current: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (current) return <p className="muted">Esta es la cuenta vinculada.</p>;

  return (
    <>
      <button
        type="button"
        className="connect-btn"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await connectGoogleAdsAccount(clientId, customerId);
            if (result.ok) router.push(`/clientes/${clientSlug}/gads`);
            else setError(result.error);
          })
        }
      >
        {pending ? "Vinculando…" : `Elegir «${accountName}»`}
      </button>
      {error && <p className="form-error">{error}</p>}
    </>
  );
}

export function DisconnectAdsButton({ clientId }: { clientId: string }) {
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
            const result = await setIntegration(clientId, "google_ads", { connected: false });
            if (!result.ok) setError(result.error);
          })
        }
      >
        {pending ? "Desvinculando…" : "Desvincular cuenta"}
      </button>
      {error && <p className="form-error">{error}</p>}
    </>
  );
}
