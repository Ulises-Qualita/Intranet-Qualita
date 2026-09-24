"use client";

import { useActionState, useState } from "react";
import { CRM_PROVIDERS, type CrmProvider } from "@/lib/crm-shared";
import { connectCrm, type FormState } from "../../../actions";

const INITIAL: FormState = { ok: false, error: null };

// Alta de las credenciales del CRM. Van directo al server: no se guardan en el
// navegador ni vuelven a mostrarse una vez conectado.
export function CrmForm({ clientId, current }: { clientId: string; current: CrmProvider | null }) {
  const [provider, setProvider] = useState<CrmProvider>(current ?? "odoo");
  const [state, formAction, pending] = useActionState(connectCrm.bind(null, clientId), INITIAL);

  const selected = CRM_PROVIDERS.find((p) => p.value === provider);

  return (
    <form action={formAction} className="stack-form">
      <label>
        <span>CRM</span>
        <select name="provider" value={provider} onChange={(e) => setProvider(e.target.value as CrmProvider)} disabled={pending}>
          {CRM_PROVIDERS.map((p) => (
            <option key={p.value} value={p.value} disabled={!p.ready}>
              {p.label}
              {p.ready ? "" : " (próximamente)"}
            </option>
          ))}
        </select>
      </label>

      {selected?.help && <p className="modal-lead">{selected.help}</p>}

      {provider === "kommo" ? (
        // key: al cambiar de CRM los campos arrancan vacíos, sin arrastrar lo tipeado.
        <div key="kommo" className="stack-form">
          <label>
            <span>Cuenta de Kommo</span>
            <input name="account" required maxLength={200} placeholder="empresa.kommo.com" autoComplete="off" />
          </label>
          <label>
            <span>Token de larga duración</span>
            <input name="token" type="password" required maxLength={4000} autoComplete="off" />
          </label>
        </div>
      ) : (
        <div key="odoo" className="stack-form">
          <label>
            <span>Dirección de Odoo</span>
            <input name="url" required maxLength={200} placeholder="https://empresa.odoo.com" autoComplete="off" />
          </label>
          <label>
            <span>Base de datos</span>
            <input name="db" required maxLength={120} placeholder="empresa" autoComplete="off" />
          </label>
          <label>
            <span>Usuario</span>
            <input name="username" required maxLength={200} placeholder="usuario@empresa.com" autoComplete="off" />
          </label>
          <label>
            <span>Clave de API</span>
            <input name="apiKey" type="password" required maxLength={200} autoComplete="off" />
          </label>
        </div>
      )}

      <div className="form-actions">
        <button type="submit" className="connect-btn" disabled={pending}>
          {pending ? "Conectando…" : "Conectar y sincronizar"}
        </button>
        {state.error && <span className="form-error">{state.error}</span>}
        {state.ok && !pending && <span className="form-ok">Conectado.</span>}
      </div>
    </form>
  );
}
