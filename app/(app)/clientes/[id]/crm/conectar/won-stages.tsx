"use client";

import { useState, useTransition } from "react";
import { setCrmWonStages } from "../../../actions";

// Qué etapas del CRM significan "venta cerrada". Va aparte de las credenciales
// porque se ajusta seguido: el pipeline de cada cliente sigue después del cierre
// (producción, entrega, post venta) y ahí el CRM ya no marca la venta como ganada.
export function WonStages({
  clientId,
  stages,
  selected,
}: {
  clientId: string;
  stages: string[];
  selected: string[];
}) {
  const [checked, setChecked] = useState<string[]>(selected);
  const [state, setState] = useState<{ ok: boolean; error: string | null }>({ ok: false, error: null });
  const [pending, startTransition] = useTransition();

  const toggle = (stage: string) =>
    setChecked((current) => (current.includes(stage) ? current.filter((s) => s !== stage) : [...current, stage]));

  return (
    <div>
      <fieldset className="stage-picker" disabled={pending}>
        <legend>Etapas que cuentan como venta ganada</legend>
        {stages.map((stage) => (
          <label key={stage} className={`stage-opt${checked.includes(stage) ? " on" : ""}`}>
            <input type="checkbox" checked={checked.includes(stage)} onChange={() => toggle(stage)} />
            {stage}
          </label>
        ))}
      </fieldset>

      <div className="form-actions mt-4">
        <button
          type="button"
          className="connect-btn"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setState({ ok: false, error: null });
              setState(await setCrmWonStages(clientId, checked));
            })
          }
        >
          {pending ? "Guardando y releyendo…" : "Guardar etapas"}
        </button>
        {state.error && <span className="form-error">{state.error}</span>}
        {state.ok && !pending && <span className="form-ok">Guardado.</span>}
      </div>
    </div>
  );
}
