"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui";
import type { FeatureKey, Features } from "@/lib/features";
import { setFeature } from "./actions";

// Funciones en prueba: un interruptor por función, para todo el equipo. Lo ve
// quien tiene el área admin, pero solo lo cambia un rol admin (la RLS de
// intranet_settings lo vuelve a validar).
export function FeaturesAdmin({
  features,
  list,
  canEdit,
}: {
  features: Features;
  list: readonly { key: FeatureKey; label: string; detail: string }[];
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <Card title="Funciones en prueba" hint="Se activan para todo el equipo" className="mt-4">
      <div className="features-list">
        {list.map((f) => {
          const on = features[f.key];
          return (
            <div key={f.key} className="feature-row">
              <div>
                <b>{f.label}</b>
                <span>{f.detail}</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={on ? `Desactivar ${f.label}` : `Activar ${f.label}`}
                className={`toggle${on ? " on" : ""}`}
                disabled={!canEdit || pending}
                onClick={() =>
                  startTransition(async () => {
                    setError(null);
                    const result = await setFeature(f.key, !on);
                    if (!result.ok) setError(result.error);
                  })
                }
              />
            </div>
          );
        })}
      </div>
      {error && <p className="form-error">{error}</p>}
      {!canEdit && <p className="muted">Solo un administrador puede cambiarlas.</p>}
    </Card>
  );
}
