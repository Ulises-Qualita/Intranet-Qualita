"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClientAvatar } from "@/components/client-avatar";
import { Card } from "@/components/ui";
import type { Client } from "@/lib/data";
import { LOGO_TYPES } from "@/lib/logos";
import { removeLogo } from "../../actions";
import { uploadClientLogo } from "../../upload-logo";

export function LogoUploader({ client }: { client: Pick<Client, "id" | "name" | "initials" | "logoUrl"> }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function upload(file: File) {
    setError(null);
    startTransition(async () => {
      const uploadError = await uploadClientLogo(client.id, file);
      if (uploadError) return setError(uploadError);
      router.refresh();
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await removeLogo(client.id);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <Card title="Logo" hint="PNG, JPG o WebP · hasta 2 MB">
      <div className="logo-uploader">
        <div className="logo-preview">
          <ClientAvatar client={client} />
        </div>
        <div className="logo-actions">
          <input
            ref={inputRef}
            type="file"
            accept={LOGO_TYPES.join(",")}
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload(file);
              e.target.value = "";
            }}
          />
          <button type="button" className="connect-btn" disabled={pending} onClick={() => inputRef.current?.click()}>
            {pending ? "Procesando…" : client.logoUrl ? "Cambiar logo" : "Subir logo"}
          </button>
          {client.logoUrl && (
            <button type="button" className="link-connect" disabled={pending} onClick={remove}>
              Quitar logo
            </button>
          )}
          {error && <span className="form-error">{error}</span>}
        </div>
      </div>
    </Card>
  );
}
