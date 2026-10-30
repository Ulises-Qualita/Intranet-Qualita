"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setGuidesFolder } from "../../../actions";

export function ChooseGuidesButton({
  clientId,
  clientSlug,
  folderId,
  folderName,
  current,
}: {
  clientId: string;
  clientSlug: string;
  folderId: string;
  folderName: string;
  current: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (current) return <p className="muted">Esta es la carpeta de guías.</p>;

  return (
    <>
      <button
        type="button"
        className="connect-btn"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await setGuidesFolder(clientId, folderId);
            if (result.ok) router.push(`/clientes/${clientSlug}/guias`);
            else setError(result.error);
          })
        }
      >
        {pending ? "Guardando…" : `Elegir «${folderName}»`}
      </button>
      {error && <p className="form-error">{error}</p>}
    </>
  );
}

export function ClearGuidesButton({ clientId }: { clientId: string }) {
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
            const result = await setGuidesFolder(clientId, null);
            if (!result.ok) setError(result.error);
          })
        }
      >
        {pending ? "Quitando…" : "Quitar carpeta de guías"}
      </button>
      {error && <p className="form-error">{error}</p>}
    </>
  );
}
