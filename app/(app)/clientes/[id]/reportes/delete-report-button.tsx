"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import { deleteReport } from "./actions";

// Dos pasos en vez de confirm(): el primer clic pide confirmar en el mismo lugar.
export function DeleteReportButton({ clientSlug, id }: { clientSlug: string; id: string }) {
  const [armed, setArmed] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      className={`report-act danger${armed ? " armed" : ""}`}
      title="Borrar reporte"
      disabled={pending}
      onBlur={() => !pending && setArmed(false)}
      onClick={() => {
        if (!armed) return setArmed(true);
        startTransition(async () => void (await deleteReport(clientSlug, id)));
      }}
    >
      <Icon name="trash" size={16} />
      <span>{pending ? "Borrando…" : armed ? "¿Seguro?" : "Borrar"}</span>
    </button>
  );
}
