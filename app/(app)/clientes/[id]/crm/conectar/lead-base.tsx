"use client";

import { useState, useTransition } from "react";
import { setCrmLeadBase } from "../../../actions";

// Qué leads cuentan como oportunidad nueva. Lo que se elige acá es lo que solo
// sabe el equipo: desde cuándo el cliente usa el CRM de verdad y qué etapas son
// pruebas. Los contactos que ya estaban y los duplicados los marca el sync solo.
export function LeadBase({
  clientId,
  stages,
  since,
  excluded,
  today,
}: {
  clientId: string;
  stages: string[];
  since: string;
  excluded: string[];
  today: string;
}) {
  const [date, setDate] = useState(since);
  const [checked, setChecked] = useState<string[]>(excluded);
  const [state, setState] = useState<{ ok: boolean; error: string | null }>({ ok: false, error: null });
  const [pending, startTransition] = useTransition();

  const toggle = (stage: string) =>
    setChecked((current) => (current.includes(stage) ? current.filter((s) => s !== stage) : [...current, stage]));

  return (
    <div>
      <div className="stack-form mb-4">
        <label>
          <span>Registro completo desde (vacío = desde siempre)</span>
          <input type="date" value={date} max={today} disabled={pending} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>

      <fieldset className="stage-picker" disabled={pending}>
        <legend>Etapas que no se cuentan</legend>
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
              setState(await setCrmLeadBase(clientId, date, checked));
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
