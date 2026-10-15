"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PROJECT_STAGES, type PortalPhase, type StageId, phasePercent } from "@/lib/portal";
import { savePortalPhase } from "../../actions";

// Editar portal → Etapas: las tres etapas son fijas; acá se elige en cuál está el
// cliente (las anteriores cuentan como completadas) y cuánto lleva de ella. De acá
// sale la card del % del portal. Se guarda con "Guardar".
export function StagesEditor({
  clientId,
  phase,
  onCancel,
  onSaved,
}: {
  clientId: string;
  phase: PortalPhase | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [stage, setStage] = useState<StageId | null>(phase?.stage ?? null);
  const [progress, setProgress] = useState(phase && phase.stage !== "motor" ? phase.progress : 0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const next: PortalPhase | null = stage ? { stage, progress } : null;
  const pct = next ? phasePercent(next) : null;

  function pick(id: StageId) {
    // Al cambiar de etapa, el avance arranca de cero.
    if (id !== stage) setProgress(0);
    setStage(id);
  }

  function save(value: PortalPhase | null) {
    setError(null);
    startTransition(async () => {
      const result = await savePortalPhase(clientId, value);
      if (!result.ok) return setError(result.error);
      router.refresh();
      onSaved();
    });
  }

  return (
    <>
      <div className="pe-panel">
        <p className="muted">
          Todos los clientes pasan por las mismas tres etapas. Elegí en cuál está: las anteriores se muestran completadas.
          Motor de Demanda es la pauta, un servicio mensual: el portal muestra ∞ en lugar del %.
        </p>

        <ol className="pe-stages" role="radiogroup" aria-label="Etapa actual">
          {PROJECT_STAGES.map((s, i) => (
            <li key={s.id}>
              <label>
                <input
                  type="radio"
                  name="portal-stage"
                  checked={stage === s.id}
                  onChange={() => pick(s.id)}
                  disabled={pending}
                />
                <span className="pe-num">{i + 1}</span>
                <span>
                  <b>{s.name}</b>
                  <small>{s.ongoing ? "Servicio mensual, sin fin" : `Del ${i * 50}% al ${(i + 1) * 50}% del proyecto`}</small>
                </span>
              </label>
            </li>
          ))}
        </ol>

        {stage && stage !== "motor" && (
          <label className="pe-progress">
            <span>Avance de la etapa</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={progress}
              onChange={(e) => setProgress(Number(e.target.value))}
              disabled={pending}
            />
            <output>{progress}%</output>
          </label>
        )}

        <p className="muted">
          {pct === null
            ? stage
              ? "El portal va a mostrar ∞ y “Servicio mensual activo”."
              : "Sin etapa elegida, el portal no muestra la card del avance."
            : `El portal va a mostrar ${pct}% del proyecto.`}
        </p>
      </div>

      {error && <p className="form-error modal-error">{error}</p>}

      <div className="modal-actions">
        {phase && (
          <button type="button" className="btn-secondary" onClick={() => save(null)} disabled={pending} style={{ marginRight: "auto" }}>
            Quitar etapa
          </button>
        )}
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={pending}>
          Cancelar
        </button>
        <button type="button" className="btn-primary" onClick={() => save(next)} disabled={pending || !next}>
          {pending ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </>
  );
}
