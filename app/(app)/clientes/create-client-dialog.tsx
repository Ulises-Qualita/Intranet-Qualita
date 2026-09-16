"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { CLIENT_STATUSES } from "@/lib/client-status";
import { LOGO_TYPES } from "@/lib/logos";
import { addClient } from "./actions";
import { uploadClientLogo, validateLogo } from "./upload-logo";

export function CreateClientDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<{ file: File; url: string } | null>(null);
  const logo = picked?.file ?? null;
  const preview = picked?.url ?? null;
  const [error, setError] = useState<string | null>(null);
  // Si el cliente se creó pero falló el logo, el reintento solo vuelve a subir el logo.
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // URL local (blob:) para previsualizar el logo elegido; se libera al reemplazarlo.
  function setLogo(file: File | null) {
    setPicked((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return file ? { file, url: URL.createObjectURL(file) } : null;
    });
  }

  function reset() {
    formRef.current?.reset();
    setLogo(null);
    setError(null);
    setCreatedId(null);
  }

  function open() {
    reset();
    dialogRef.current?.showModal();
  }

  function close() {
    if (!pending) dialogRef.current?.close();
  }

  function pickLogo(file: File | undefined) {
    if (!file) return;
    const invalid = validateLogo(file);
    setError(invalid);
    setLogo(invalid ? null : file);
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setError(null);

    startTransition(async () => {
      let clientId = createdId;
      if (!clientId) {
        const created = await addClient(formData);
        if (!created.ok) return setError(created.error);
        clientId = created.clientId;
        setCreatedId(clientId);
        router.refresh();
      }

      if (logo) {
        const uploadError = await uploadClientLogo(clientId, logo);
        if (uploadError) {
          return setError(`El cliente se creó, pero no se pudo subir el logo: ${uploadError} Reintentá o cerrá y subilo desde Editar.`);
        }
      }

      dialogRef.current?.close();
      reset();
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" className="connect-btn" onClick={open}>
        <Icon name="plus" size={16} strokeWidth={2} />
        Crear cliente
      </button>

      <dialog
        ref={dialogRef}
        className="modal"
        aria-labelledby="create-client-title"
        onCancel={(e) => {
          if (pending) e.preventDefault();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        <form ref={formRef} className="modal-card modal-form" onSubmit={submit} noValidate>
          <div className="modal-head">
            <h2 id="create-client-title">Nuevo cliente</h2>
            <button type="button" className="modal-close" onClick={close} disabled={pending} aria-label="Cerrar">
              ×
            </button>
          </div>

          <div className="logo-field">
            <button
              type="button"
              className={`logo-drop${preview ? " has-logo" : ""}`}
              onClick={() => fileRef.current?.click()}
              disabled={pending}
              aria-label={logo ? "Cambiar logo" : "Subir logo"}
            >
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element -- previsualización local (blob:)
                <img src={preview} alt="Logo seleccionado" />
              ) : (
                <Icon name="media" size={26} />
              )}
            </button>
            <div className="logo-field-txt">
              <b>{logo ? logo.name : "Logo"}</b>
              <span>PNG, JPG o WebP · hasta 2 MB · opcional</span>
              <div className="logo-field-actions">
                <button type="button" className="link-connect" onClick={() => fileRef.current?.click()} disabled={pending}>
                  {logo ? "Cambiar" : "Elegir archivo"}
                </button>
                {logo && (
                  <button type="button" className="link-danger" onClick={() => setLogo(null)} disabled={pending}>
                    Quitar
                  </button>
                )}
              </div>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept={LOGO_TYPES.join(",")}
              hidden
              onChange={(e) => {
                pickLogo(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>

          <div className="stack-form">
            <label>
              <span>Nombre *</span>
              <input name="name" required maxLength={120} placeholder="Ej.: Arteplac" autoComplete="off" autoFocus />
            </label>
            <label>
              <span>Rubro</span>
              <input name="sector" maxLength={160} placeholder="Ej.: Revestimientos decorativos" autoComplete="off" />
            </label>
            <div className="form-row">
              <label>
                <span>Web</span>
                <input name="website" maxLength={200} placeholder="marca.com" autoComplete="off" />
              </label>
              <label>
                <span>Estado</span>
                <select name="status" defaultValue="lead">
                  {CLIENT_STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {error && <p className="form-error modal-error">{error}</p>}

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={close} disabled={pending}>
              {createdId ? "Cerrar" : "Cancelar"}
            </button>
            <button type="submit" className="btn-primary" disabled={pending}>
              {pending ? "Guardando…" : createdId ? "Reintentar logo" : "Crear cliente"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
