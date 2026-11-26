"use client";

import { useState, useTransition } from "react";
import { setCrmSalesOff } from "../../../actions";

// Para clientes que registran las ventas fuera del CRM (Amarante: en Notion). Con
// la opción activa, nada del CRM cuenta como venta y los montos quedan vacíos. En
// lugar de "Ganadas" se puede mostrar cuántas oportunidades llegaron a una etapa.
export function SalesOff({
  clientId,
  current,
  stages,
  milestone,
}: {
  clientId: string;
  current: boolean;
  stages: string[];
  milestone: string;
}) {
  const [off, setOff] = useState(current);
  const [stage, setStage] = useState(milestone);
  const [state, setState] = useState<{ ok: boolean; error: string | null }>({ ok: false, error: null });
  const [pending, startTransition] = useTransition();
  const changed = off !== current || (off && stage !== milestone);

  return (
    <div>
      <fieldset className="stage-picker" disabled={pending}>
        <legend>Origen de las ventas</legend>
        <label className={`stage-opt${off ? " on" : ""}`}>
          <input type="checkbox" checked={off} onChange={() => setOff((v) => !v)} />
          Las ventas no se registran en este CRM
        </label>
      </fieldset>

      {off && (
        <div className="stack-form mt-4">
          <label>
            En lugar de &quot;Ganadas&quot;, mostrar los leads que llegaron a la etapa
            <select value={stage} onChange={(e) => setStage(e.target.value)} disabled={pending}>
              <option value="">Ninguna (Ganadas queda pendiente)</option>
              {stages.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div className="form-actions mt-4">
        <button
          type="button"
          className="connect-btn"
          disabled={pending || !changed}
          onClick={() =>
            startTransition(async () => {
              setState({ ok: false, error: null });
              setState(await setCrmSalesOff(clientId, off, off ? stage : ""));
            })
          }
        >
          {pending ? "Guardando y releyendo…" : "Guardar"}
        </button>
        {state.error && <span className="form-error">{state.error}</span>}
        {state.ok && !pending && <span className="form-ok">Guardado.</span>}
      </div>
    </div>
  );
}
