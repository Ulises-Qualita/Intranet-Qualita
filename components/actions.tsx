"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Icon, type IconName } from "./icons";

// Botones de acción de una fila (Abrir, Editar, Borrar…): siempre con ícono y
// borde, nunca texto plano. `danger` para borrar. Usarlos en toda acción nueva.
export function ActionButton({
  icon,
  children,
  danger,
  onClick,
  disabled,
  title,
}: {
  icon: IconName;
  children: React.ReactNode;
  danger?: boolean;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button type="button" className={`act-btn${danger ? " danger" : ""}`} onClick={onClick} disabled={disabled} title={title}>
      <Icon name={icon} size={14} strokeWidth={2} />
      <span>{children}</span>
    </button>
  );
}

// Lo mismo, cuando la acción es ir a un link (descargar, abrir en otra pestaña).
export function ActionLink({
  icon,
  children,
  href,
  download,
  external,
}: {
  icon: IconName;
  children: React.ReactNode;
  href: string;
  download?: boolean;
  external?: boolean;
}) {
  return (
    <a
      className="act-btn"
      href={href}
      download={download || undefined}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
    >
      <Icon name={icon} size={14} strokeWidth={2} />
      <span>{children}</span>
    </a>
  );
}

// Modal de confirmación (en lugar de window.confirm). Se monta al pedirlo y se
// abre solo; `onConfirm` devuelve el resultado de la Server Action: si falla, el
// error queda en el modal y no se cierra.
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  pendingLabel = "Borrando…",
  icon = "trash",
  danger = true,
  onConfirm,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  pendingLabel?: string;
  icon?: IconName;
  danger?: boolean;
  onConfirm: () => Promise<{ ok: boolean; error: string | null }>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const close = () => {
    if (!pending) ref.current?.close();
  };

  const confirm = () =>
    startTransition(async () => {
      setError(null);
      const result = await onConfirm();
      if (!result.ok) return setError(result.error);
      ref.current?.close();
    });

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="confirm-dialog-title"
      onClose={onClose}
      onCancel={(e) => {
        if (pending) e.preventDefault();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal-card">
        <div className={`modal-ico${danger ? "" : " neutral"}`}>
          <Icon name={icon} />
        </div>
        <h2 id="confirm-dialog-title">{title}</h2>
        <p>{children}</p>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={close} disabled={pending} autoFocus>
            Cancelar
          </button>
          <button type="button" className={danger ? "btn-danger" : "btn-secondary btn-primary"} onClick={confirm} disabled={pending}>
            {pending ? pendingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
