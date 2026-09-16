"use client";

import { useActionState } from "react";
import { Card } from "@/components/ui";
import type { Client } from "@/lib/data";
import { updateClient, type FormState } from "../../actions";

const INITIAL: FormState = { ok: false, error: null };

export function ClientEditForm({ client }: { client: Pick<Client, "id" | "name" | "sector" | "website"> }) {
  const [state, formAction, pending] = useActionState(updateClient.bind(null, client.id), INITIAL);

  return (
    <Card title="Datos del cliente">
      <form action={formAction} className="stack-form">
        <label>
          <span>Nombre *</span>
          <input name="name" required maxLength={120} defaultValue={client.name} autoComplete="off" />
        </label>
        <label>
          <span>Rubro</span>
          <input
            name="sector"
            maxLength={160}
            defaultValue={client.sector ?? ""}
            placeholder="Ej.: Revestimientos decorativos"
            autoComplete="off"
          />
        </label>
        <label>
          <span>Web</span>
          <input name="website" maxLength={200} defaultValue={client.website ?? ""} placeholder="marca.com" autoComplete="off" />
        </label>
        <div className="form-actions">
          <button type="submit" className="connect-btn" disabled={pending}>
            {pending ? "Guardando…" : "Guardar cambios"}
          </button>
          {state.error && <span className="form-error">{state.error}</span>}
          {state.ok && !pending && <span className="form-ok">Guardado.</span>}
        </div>
      </form>
    </Card>
  );
}
