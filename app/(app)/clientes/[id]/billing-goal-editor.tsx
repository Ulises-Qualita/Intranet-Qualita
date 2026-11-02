"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { parseAmount } from "@/lib/billing-goals";
import { saveBillingGoal } from "../actions";

// "Editar objetivo" (solo equipo): el objetivo de facturación en pesos del mes del
// período. `own` es el cargado para ese mes; `inherited`, el que hereda de un mes
// anterior si no tiene uno propio.
export function BillingGoalEditor({
  clientId,
  month,
  monthLabel,
  own,
  inherited,
}: {
  clientId: string;
  month: string;
  monthLabel: string;
  own: number | null;
  inherited: { amount: number; label: string } | null;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const format = (n: number) => n.toLocaleString("es-AR");

  function open() {
    setValue(own ? format(own) : "");
    setError(null);
    dialogRef.current?.showModal();
  }

  function close() {
    if (!pending) dialogRef.current?.close();
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const amount = parseAmount(value);
    if (amount === "invalid") return setError("Ingresá un monto en pesos, por ejemplo 5.000.000.");
    setError(null);
    startTransition(async () => {
      const saved = await saveBillingGoal(clientId, month, amount);
      if (!saved.ok) return setError(saved.error);
      dialogRef.current?.close();
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" className="btn-secondary btn-sm" onClick={open}>
        <Icon name="settings" size={15} />
        {own || inherited ? "Editar objetivo" : "Cargar objetivo"}
      </button>

      <dialog
        ref={dialogRef}
        className="modal"
        aria-labelledby="billing-goal-title"
        onCancel={(e) => {
          if (pending) e.preventDefault();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        <div className="modal-card modal-form">
          <div className="modal-head">
            <h2 id="billing-goal-title">Objetivo de {monthLabel}</h2>
            <button type="button" className="modal-close" onClick={close} disabled={pending} aria-label="Cerrar">
              ×
            </button>
          </div>

          <form onSubmit={submit} noValidate>
            <div className="stack-form">
              <label>
                <span>Facturación objetivo (en pesos)</span>
                <input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={inherited ? format(inherited.amount) : "5.000.000"}
                  inputMode="decimal"
                  autoComplete="off"
                  autoFocus
                />
              </label>
              <p className="muted">
                Sigue vigente en los meses siguientes hasta que cargues otro.
                {inherited && !own
                  ? ` Hoy ${monthLabel} usa el de ${inherited.label} ($${format(inherited.amount)}).`
                  : own
                    ? " Vacío lo borra y el mes vuelve a usar el del último mes cargado antes."
                    : ""}
              </p>
            </div>

            {error && <p className="form-error modal-error">{error}</p>}

            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={close} disabled={pending}>
                Cancelar
              </button>
              <button type="submit" className="btn-primary" disabled={pending}>
                {pending ? "Guardando…" : "Guardar"}
              </button>
            </div>
          </form>
        </div>
      </dialog>
    </>
  );
}
