"use client";

import { useState, useTransition } from "react";
import { removeCrmSalesSheet, setCrmSalesSheet } from "../../../actions";

// Planilla de Google Sheets con las ventas confirmadas. Se pega el link; las
// columnas se reconocen por el encabezado (lib/sales-sheet.ts).
export function SalesSheet({ clientId, current }: { clientId: string; current: string | null }) {
  const [link, setLink] = useState(current ?? "");
  const [state, setState] = useState<{ ok: boolean; error: string | null }>({ ok: false, error: null });
  const [pending, startTransition] = useTransition();

  const run = (action: () => Promise<{ ok: boolean; error: string | null }>) =>
    startTransition(async () => {
      setState({ ok: false, error: null });
      setState(await action());
    });

  return (
    <div>
      <div className="stack-form mb-4">
        <label>
          <span>Link de la planilla</span>
          <input
            type="url"
            value={link}
            placeholder="https://docs.google.com/spreadsheets/d/…"
            disabled={pending}
            onChange={(e) => setLink(e.target.value)}
          />
        </label>
      </div>

      <div className="form-actions">
        <button
          type="button"
          className="connect-btn"
          disabled={pending || !link.trim()}
          onClick={() => run(() => setCrmSalesSheet(clientId, link))}
        >
          {pending ? "Leyendo la planilla…" : current ? "Guardar y releer" : "Conectar planilla"}
        </button>
        {current && (
          <button
            type="button"
            className="link-connect"
            disabled={pending}
            onClick={() =>
              run(async () => {
                const result = await removeCrmSalesSheet(clientId);
                if (result.ok) setLink("");
                return result;
              })
            }
          >
            Dejar de usar la planilla
          </button>
        )}
        {state.error && <span className="form-error">{state.error}</span>}
        {state.ok && !pending && <span className="form-ok">Guardado.</span>}
      </div>
    </div>
  );
}
