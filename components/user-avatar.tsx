"use client";

import { useState } from "react";
import { initialsOf } from "@/lib/auth-shared";

// Foto de Google del usuario; si no hay o falla la carga, iniciales sobre el degradado.
export function UserAvatar({
  name,
  avatarUrl,
  className,
}: {
  name: string;
  avatarUrl: string | null;
  className: string;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <div className={`${className} photo-av`} style={{ background: "var(--grad)" }}>
      {initialsOf(name)}
      {avatarUrl && !failed && (
        // eslint-disable-next-line @next/next/no-img-element -- foto externa de Google, chica
        <img src={avatarUrl} alt={name} referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      )}
    </div>
  );
}
