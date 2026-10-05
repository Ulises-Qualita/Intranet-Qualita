"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui";
import { AI_EFFORTS, AI_MODELS, AI_TASKS, type AiConfig, type AiEffort, type AiTask } from "@/lib/ai-models";
import { saveAiConfig } from "./actions";

// Modelo y esfuerzo de cada uso de Claude. Lo ve quien tiene el área admin, pero
// solo lo cambia un rol admin (la RLS de intranet_settings lo vuelve a validar).
export function AiSettings({ config, canEdit }: { config: AiConfig; canEdit: boolean }) {
  const [value, setValue] = useState(config);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const set = (task: AiTask, patch: Partial<AiConfig[AiTask]>) => {
    setValue((v) => ({ ...v, [task]: { ...v[task], ...patch } }));
    setSaved(false);
  };

  // Un modelo fuera de la lista (p. ej. el de la env ANTHROPIC_MODEL) se muestra
  // igual, para que el select no mienta sobre lo que se está usando.
  const modelOptions = (current: string) =>
    AI_MODELS.some((m) => m.id === current) ? AI_MODELS : [...AI_MODELS, { id: current, label: current, price: "" }];

  return (
    <Card title="Modelo de IA" hint="Precio por millón de tokens: entrada / salida">
      <form
        className="stack-form"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          startTransition(async () => {
            const result = await saveAiConfig(value);
            if (result.ok) setSaved(true);
            else setError(result.error);
          });
        }}
      >
        <fieldset className="ai-settings" disabled={!canEdit || pending}>
          {AI_TASKS.map((task) => (
            <div key={task.key} className="form-row">
              <label>
                <span>
                  {task.label} · modelo
                </span>
                <select value={value[task.key].model} onChange={(e) => set(task.key, { model: e.target.value })}>
                  {modelOptions(value[task.key].model).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.price ? `${m.label} · ${m.price}` : m.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Esfuerzo</span>
                <select
                  value={value[task.key].effort ?? ""}
                  onChange={(e) => set(task.key, { effort: (e.target.value || null) as AiEffort | null })}
                >
                  <option value="">Por defecto del modelo</option>
                  {AI_EFFORTS.map((ef) => (
                    <option key={ef.id} value={ef.id}>
                      {ef.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ))}
        </fieldset>

        <p className="muted">
          Más esfuerzo es más razonamiento antes de responder: respuestas más pensadas, más lentas y más caras. El
          esfuerzo por defecto es Medio en Opus 5.5 y Alto en los demás. Cambiar el modelo no afecta las conversaciones
          ya guardadas.
        </p>

        {canEdit ? (
          <div className="form-actions">
            <button type="submit" className="btn-primary" disabled={pending}>
              {pending ? "Guardando…" : "Guardar"}
            </button>
            {error && <p className="form-error">{error}</p>}
            {saved && !error && <p className="form-ok">Guardado. Rige desde la próxima consulta.</p>}
          </div>
        ) : (
          <p className="muted">Solo un administrador puede cambiarlo.</p>
        )}
      </form>
    </Card>
  );
}
