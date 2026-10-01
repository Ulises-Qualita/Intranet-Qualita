"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { connectDriveFolder, setIntegration } from "../../../actions";

export function ChooseFolderButton({
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

  if (current) return <p className="muted">Esta es la carpeta vinculada.</p>;

  return (
    <>
      <button
        type="button"
        className="connect-btn"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await connectDriveFolder(clientId, folderId);
            if (result.ok) router.push(`/clientes/${clientSlug}/drive`);
            else setError(result.error);
          })
        }
      >
        {pending ? "Vinculando…" : `Elegir «${folderName}»`}
      </button>
      {error && <p className="form-error">{error}</p>}
    </>
  );
}

export function DisconnectDriveButton({ clientId }: { clientId: string }) {
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
            const result = await setIntegration(clientId, "drive", { connected: false });
            if (!result.ok) setError(result.error);
          })
        }
      >
        {pending ? "Desvinculando…" : "Desvincular carpeta"}
      </button>
      {error && <p className="form-error">{error}</p>}
    </>
  );
}
