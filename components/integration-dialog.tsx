"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { setIntegration } from "@/app/(app)/clientes/actions";
import { integrationMeta, type Integration, type IntegrationState } from "@/lib/integrations";
import { Icon } from "./icons";

type Trigger = "pill" | "button" | "link";

export function IntegrationDialog({
  clientId,
  clientSlug,
  clientName,
  provider,
  state,
  trigger = "pill",
  triggerLabel,
}: {
  clientId: string;
  clientSlug: string;
  clientName: string;
  provider: Integration;
  state: IntegrationState;
  trigger?: Trigger;
  triggerLabel?: string;
}) {
  const meta = integrationMeta(provider);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [accountRef, setAccountRef] = useState(state.accountRef ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const titleId = `integration-${clientId}-${provider}`;

  function open() {
    setAccountRef(state.accountRef ?? "");
    setError(null);
    dialogRef.current?.showModal();
  }

  const close = () => {
    if (!pending) dialogRef.current?.close();
  };

  function save(connected: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await setIntegration(clientId, provider, { connected, accountRef });
      if (result.ok) dialogRef.current?.close();
      else setError(result.error);
    });
  }

  const label = triggerLabel ?? (state.connected ? meta.label : `Conectar ${meta.label}`);

  // Meta se conecta con login de Facebook en su propia página, no con este modal.
  if (provider === "meta") {
    const href = `/clientes/${clientSlug}/meta/conectar`;
    if (trigger === "pill") {
      return (
        <Link
          href={href}
          className={`integ-pill${state.connected ? " on" : ""}`}
          title={state.connected ? `${meta.title}: ${state.accountRef ?? "conectado"}` : `Conectar ${meta.title}`}
        >
          {state.connected ? <span className="integ-dot" aria-hidden /> : <Icon name="plus" size={12} strokeWidth={2.2} />}
          {meta.label}
        </Link>
      );
    }
    return (
      <Link href={href} className={trigger === "button" ? "connect-btn" : "link-connect"}>
        {trigger === "button" && <Icon name="plus" size={16} strokeWidth={2} />}
        {label}
      </Link>
    );
  }

  return (
    <>
      {trigger === "pill" && (
        <button
          type="button"
          className={`integ-pill${state.connected ? " on" : ""}`}
          onClick={open}
          title={state.connected ? `${meta.title}: ${state.accountRef ?? "conectado"}` : `Conectar ${meta.title}`}
        >
          {state.connected ? <span className="integ-dot" aria-hidden /> : <Icon name="plus" size={12} strokeWidth={2.2} />}
          {meta.label}
        </button>
      )}
      {trigger === "button" && (
        <button type="button" className="connect-btn" onClick={open}>
          <Icon name="plus" size={16} strokeWidth={2} />
          {label}
        </button>
      )}
      {trigger === "link" && (
        <button type="button" className="link-connect" onClick={open}>
          {label}
        </button>
      )}

      <dialog
        ref={dialogRef}
        className="modal"
        aria-labelledby={titleId}
        onCancel={(e) => {
          if (pending) e.preventDefault();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        <form
          className="modal-card modal-form"
          onSubmit={(e) => {
            e.preventDefault();
            save(true);
          }}
          noValidate
        >
          <div className="modal-head">
            <h2 id={titleId}>
              {meta.title} · {clientName}
            </h2>
            <button type="button" className="modal-close" onClick={close} disabled={pending} aria-label="Cerrar">
              ×
            </button>
          </div>

          <p className="modal-lead">
            {state.connected ? (
              <span className="status on">Conectado</span>
            ) : (
              <span className="pill pendiente">No conectado</span>
            )}{" "}
            {meta.help}
          </p>

          <div className="stack-form">
            <label>
              <span>{meta.refLabel}</span>
              <input
                value={accountRef}
                onChange={(e) => setAccountRef(e.target.value)}
                maxLength={200}
                placeholder={meta.placeholder}
                autoComplete="off"
                autoFocus
              />
            </label>
          </div>

          {error && <p className="form-error modal-error">{error}</p>}

          <div className="modal-actions">
            {state.connected ? (
              <button type="button" className="btn-secondary btn-danger-outline" onClick={() => save(false)} disabled={pending}>
                Desconectar
              </button>
            ) : (
              <button type="button" className="btn-secondary" onClick={close} disabled={pending}>
                Cancelar
              </button>
            )}
            <button type="submit" className="btn-primary" disabled={pending}>
              {pending ? "Guardando…" : state.connected ? "Guardar cambios" : "Conectar"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
