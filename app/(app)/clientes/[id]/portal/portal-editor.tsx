"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import {
  BANNER_CENTER,
  BANNER_MAX_BYTES,
  BANNER_TYPES,
  BANNERS_BUCKET,
  type BannerPosition,
  type PortalStage,
  type PortalValidator,
  VALIDATOR_MAX,
} from "@/lib/portal";
import type { Milestone } from "@/lib/milestones-shared";
import { createClient } from "@/lib/supabase/client";
import {
  bannerUploaded,
  createBannerUpload,
  removeBanner,
  saveBannerPosition,
  savePortalValidator,
} from "../../actions";
import { BannerCrop } from "./banner-crop";
import { MilestonesEditor } from "./milestones-editor";
import { StagesEditor } from "./stages-editor";

const TABS = [
  { id: "general", label: "General" },
  { id: "etapas", label: "Etapas" },
  { id: "hitos", label: "Hitos" },
] as const;
type Tab = (typeof TABS)[number]["id"];

function validateBanner(file: File): string | null {
  if (!BANNER_TYPES.includes(file.type)) return "Subí un PNG, JPG o WebP.";
  if (file.size > BANNER_MAX_BYTES) return "El banner no puede pesar más de 5 MB.";
  return null;
}

// Como el logo: el server firma la subida y el archivo va directo del navegador a
// Storage, sin pasar por el límite de body de las Server Actions.
async function uploadBanner(clientId: string, file: File, position: BannerPosition): Promise<string | null> {
  const signed = await createBannerUpload(clientId, {
    type: file.type,
    size: file.size,
  });
  if (!signed.ok) return signed.error;
  const { error } = await createClient()
    .storage.from(BANNERS_BUCKET)
    .uploadToSignedUrl(signed.path, signed.token, file, {
      contentType: file.type,
      upsert: true,
    });
  if (error) return "No se pudo subir el banner.";
  const saved = await bannerUploaded(clientId, position);
  return saved.ok ? null : saved.error;
}

const EMPTY: PortalValidator = { name: "", role: "", phone: "" };

// "Editar portal" (solo equipo), en tres solapas: General (banner y responsable
// validador), Etapas (las del % del portal) e Hitos (la línea de hitos). El logo es
// el del cliente y se cambia en Editar cliente; los tickets del calendario salen de
// Notion. General y Etapas se guardan con "Guardar"; cada hito, al momento.
export function PortalEditor({
  clientId,
  clientSlug,
  validator,
  banner,
  bannerPosition,
  stages,
  milestones,
  milestonesMissing,
}: {
  clientId: string;
  clientSlug: string;
  validator: PortalValidator | null;
  banner: string | null;
  bannerPosition: BannerPosition;
  stages: PortalStage[];
  milestones: Milestone[];
  milestonesMissing: boolean;
}) {
  const [tab, setTab] = useState<Tab>("general");
  // Cambia en cada apertura: las solapas vuelven a lo guardado (se descartan cambios sin guardar).
  const [session, setSession] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<PortalValidator>(validator ?? EMPTY);
  // Banner elegido y todavía sin subir (con su vista previa local), o quitado.
  const [picked, setPicked] = useState<{ file: File; url: string } | null>(null);
  const [removed, setRemoved] = useState(false);
  // Qué parte del banner se ve; se acomoda arrastrando la vista previa.
  const [position, setPosition] = useState(bannerPosition);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const preview = picked?.url ?? (removed ? null : banner);

  function pick(file: File | null) {
    setPicked((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return file ? { file, url: URL.createObjectURL(file) } : null;
    });
  }

  function open() {
    setForm(validator ?? EMPTY);
    pick(null);
    setRemoved(false);
    setPosition(bannerPosition);
    setError(null);
    setTab("general");
    setSession((n) => n + 1);
    dialogRef.current?.showModal();
  }

  function close() {
    if (!pending) dialogRef.current?.close();
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const saved = await savePortalValidator(clientId, form);
      if (!saved.ok) return setError(saved.error);

      if (picked) {
        const uploadError = await uploadBanner(clientId, picked.file, position);
        if (uploadError) return setError(`El responsable se guardó, pero no el banner: ${uploadError}`);
      } else if (removed && banner) {
        const result = await removeBanner(clientId);
        if (!result.ok) return setError(result.error);
      } else if (banner && (position.x !== bannerPosition.x || position.y !== bannerPosition.y)) {
        const result = await saveBannerPosition(clientId, position);
        if (!result.ok) return setError(result.error);
      }

      dialogRef.current?.close();
      pick(null);
      router.refresh();
    });
  }

  const field = (key: keyof PortalValidator) => ({
    value: form[key],
    maxLength: VALIDATOR_MAX[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value })),
  });

  return (
    <>
      <button type="button" className="btn-secondary btn-sm" onClick={open}>
        <Icon name="settings" size={15} />
        Editar portal
      </button>

      <dialog
        ref={dialogRef}
        className="modal"
        aria-labelledby="portal-editor-title"
        onCancel={(e) => {
          if (pending) e.preventDefault();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        <div className="modal-card modal-form portal-editor-card">
          <div className="modal-head">
            <h2 id="portal-editor-title">Editar portal</h2>
            <button type="button" className="modal-close" onClick={close} disabled={pending} aria-label="Cerrar">
              ×
            </button>
          </div>

          <div className="pe-tabs" role="tablist" aria-label="Secciones del portal">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={tab === t.id ? "on" : undefined}
                onClick={() => setTab(t.id)}
                disabled={pending}
              >
                {t.label}
                {t.id === "etapas" && stages.length > 0 && <span>{stages.length}</span>}
                {t.id === "hitos" && milestones.length > 0 && <span>{milestones.length}</span>}
              </button>
            ))}
          </div>

          {tab === "etapas" && (
            <StagesEditor key={session} clientId={clientId} stages={stages} onCancel={close} onSaved={close} />
          )}

          {tab === "hitos" && (
            <MilestonesEditor
              key={session}
              clientSlug={clientSlug}
              milestones={milestones}
              missing={milestonesMissing}
              onClose={close}
            />
          )}

          <form onSubmit={submit} noValidate hidden={tab !== "general"}>
            <div className="stack-form">
              <div className="banner-field">
                <span className="banner-label">Banner</span>
                {preview ? (
                  <BannerCrop src={preview} position={position} onChange={setPosition} disabled={pending} />
                ) : (
                  <button
                    type="button"
                    className="banner-drop"
                    onClick={() => fileRef.current?.click()}
                    disabled={pending}
                    aria-label="Subir banner"
                  >
                    <Icon name="image" size={26} />
                  </button>
                )}
                <div className="banner-actions">
                  <span>PNG, JPG o WebP · hasta 5 MB · se ve mejor apaisado (unos 1600 × 300)</span>
                  <div className="logo-field-actions">
                    <button
                      type="button"
                      className="link-connect"
                      onClick={() => fileRef.current?.click()}
                      disabled={pending}
                    >
                      {preview ? "Cambiar" : "Elegir archivo"}
                    </button>
                    {preview && (
                      <button
                        type="button"
                        className="link-danger"
                        onClick={() => {
                          pick(null);
                          setRemoved(true);
                        }}
                        disabled={pending}
                      >
                        Quitar
                      </button>
                    )}
                  </div>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept={BANNER_TYPES.join(",")}
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    const invalid = validateBanner(file);
                    setError(invalid);
                    if (!invalid) {
                      pick(file);
                      setRemoved(false);
                      // Una imagen nueva arranca centrada: la posición de la anterior no le sirve.
                      setPosition(BANNER_CENTER);
                    }
                  }}
                />
              </div>

              <label>
                <span>Responsable validador</span>
                <input {...field("name")} placeholder="Nombre y apellido" autoComplete="off" />
              </label>
              <div className="form-row">
                <label>
                  <span>Cargo</span>
                  <input {...field("role")} placeholder="Ej.: Socia" autoComplete="off" />
                </label>
                <label>
                  <span>WhatsApp</span>
                  <input {...field("phone")} placeholder="+54 9 11 1234-5678" inputMode="tel" autoComplete="off" />
                </label>
              </div>
              <p className="muted">Es quien aprueba los entregables. Sin nombre, el portal no muestra esta sección.</p>
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
