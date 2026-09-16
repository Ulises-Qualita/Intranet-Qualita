"use client";

import { useRef, useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import { deleteClient } from "./actions";

export function DeleteClientButton({ clientId, name }: { clientId: string; name: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();

  const expected = `BORRAR ${name}`;
  const matches = typed === expected;

  const open = () => {
    setError(null);
    setTyped("");
    dialogRef.current?.showModal();
  };
  const close = () => {
    if (!pending) dialogRef.current?.close();
  };

  function confirm() {
    if (!matches) return;
    startTransition(async () => {
      const result = await deleteClient(clientId, typed);
      if (result.ok) dialogRef.current?.close();
      else setError(result.error);
    });
  }

  return (
    <>
      <button type="button" className="link-danger" onClick={open}>
        Borrar
      </button>

      {/* <dialog> nativo: capa superior, fondo a pantalla completa, Escape y foco atrapado. */}
      <dialog
        ref={dialogRef}
        className="modal"
        aria-labelledby={`delete-title-${clientId}`}
        onCancel={(e) => {
          if (pending) e.preventDefault();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        <div className="modal-card">
          <div className="modal-ico">
            <Icon name="shield" />
          </div>
          <h2 id={`delete-title-${clientId}`}>¿Borrar {name}?</h2>
          <p>
            Se van a eliminar el cliente y todos sus datos: tareas, métricas de Meta, CRM, leads, integraciones,
            responsables y logo. <b>Esta acción no se puede deshacer.</b>
          </p>
          <form
            className="modal-confirm"
            onSubmit={(e) => {
              e.preventDefault();
              confirm();
            }}
          >
            <label htmlFor={`delete-confirm-${clientId}`}>
              Para confirmar, escribí <b>{expected}</b>
            </label>
            <input
              id={`delete-confirm-${clientId}`}
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              disabled={pending}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </form>
          {error && <p className="form-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={close} disabled={pending} autoFocus>
              Cancelar
            </button>
            <button type="button" className="btn-danger" onClick={confirm} disabled={pending || !matches}>
              {pending ? "Borrando…" : "Sí, borrar cliente"}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
