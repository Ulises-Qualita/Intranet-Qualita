"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionButton, ConfirmDialog } from "@/components/actions";
import { Icon, type IconName } from "@/components/icons";
import { Card } from "@/components/ui";
import type { Platform } from "@/lib/analysis/shared";
import {
  type AdCriterion,
  CRITERIA_ACCEPT,
  CRITERIA_BUCKET,
  criteriaFileType,
  MAX_CRITERION_TEXT,
  MAX_CRITERION_TITLE,
} from "@/lib/ad-criteria-shared";
import { fileSize, shortDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import {
  createCriterionUpload,
  criterionFileUrl,
  criterionUploaded,
  deleteCriterion,
  saveCriterion,
  setCriterionActive,
} from "./criteria-actions";

type Editing = { id: string | null; kind: AdCriterion["kind"]; title: string; content: string };

const iconOf = (c: AdCriterion): IconName =>
  c.kind === "texto" ? "file-text" : c.mimeType?.startsWith("image/") ? "image" : c.mimeType === "application/pdf" ? "doc" : "file";

// El criterio de una plataforma: la lista (con pausa, edición y borrado) y los
// botones para escribir uno o subir archivos. Solo un rol admin lo cambia.
export function CriteriaAdmin({
  platform,
  label,
  items,
  names,
  canEdit,
}: {
  platform: Platform;
  label: string;
  items: AdCriterion[];
  names: Record<string, string>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<(Editing & { n: number }) | null>(null);
  const [deleting, setDeleting] = useState<AdCriterion | null>(null);
  const active = items.filter((c) => c.active).length;

  const run = (fn: () => Promise<{ ok: boolean; error: string | null }>) =>
    startTransition(async () => {
      setError(null);
      const result = await fn();
      if (!result.ok) setError(result.error);
    });

  // Sube de a uno: URL firmada → Storage → el server extrae el texto y guarda la fila.
  async function upload(files: FileList) {
    setError(null);
    for (const file of Array.from(files)) {
      const type = criteriaFileType(file.name);
      if (!type) {
        setError(`${file.name}: subí un PDF, Word (.docx), texto (.txt, .md, .csv) o imagen (PNG, JPG, WebP).`);
        continue;
      }
      if (file.size > type.max) {
        setError(`${file.name}: pasa el máximo de ${Math.round(type.max / 1024 / 1024)} MB.`);
        continue;
      }
      setUploading(file.name);
      const signed = await createCriterionUpload(platform, { name: file.name, size: file.size });
      if (!signed.ok) {
        setError(`${file.name}: ${signed.error}`);
        continue;
      }
      const { error: uploadError } = await createClient()
        .storage.from(CRITERIA_BUCKET)
        .uploadToSignedUrl(signed.path, signed.token, file, { contentType: type.mime });
      if (uploadError) {
        setError(`${file.name}: no se pudo subir.`);
        continue;
      }
      const saved = await criterionUploaded(platform, signed.path, file.name);
      if (!saved.ok) setError(`${file.name}: ${saved.error}`);
    }
    setUploading(null);
    router.refresh();
  }

  function open(c: AdCriterion) {
    startTransition(async () => {
      setError(null);
      const result = await criterionFileUrl(c.id);
      if (!result.ok) return setError(result.error);
      window.open(result.url, "_blank", "noopener");
    });
  }

  const busy = pending || uploading !== null;

  return (
    <Card
      title={label}
      action={<span className="hint">{items.length ? `${active} de ${items.length} activos` : "Sin criterio"}</span>}
    >
      {items.length === 0 ? (
        <p className="crit-empty">
          Todavía no hay criterio para {label}. Claude analiza con buenas prácticas generales hasta que cargues el de la agencia.
        </p>
      ) : (
        <ul className="crit-list">
          {items.map((c) => (
            <li key={c.id} className={c.active ? undefined : "off"}>
              <span className="crit-ico" aria-hidden>
                <Icon name={iconOf(c)} size={17} />
              </span>
              <div className="crit-txt">
                <b>{c.title}</b>
                <span>
                  {c.kind === "texto"
                    ? `Texto · ${(c.content ?? "").length.toLocaleString("es-AR")} caracteres`
                    : `${criteriaFileType(c.fileName ?? "")?.label ?? "Archivo"} · ${fileSize(c.size)}`}
                  {" · "}
                  {shortDate(c.createdAt.slice(0, 10))}
                  {c.createdBy && names[c.createdBy] ? ` · ${names[c.createdBy]}` : ""}
                  {!c.active && " · pausado"}
                </span>
                <div className="crit-actions">
                  {c.kind === "archivo" && (
                    <ActionButton icon="arrow-out" onClick={() => open(c)} disabled={busy}>
                      Abrir
                    </ActionButton>
                  )}
                  {canEdit && (
                    <>
                      <ActionButton
                        icon="pencil"
                        disabled={busy}
                        onClick={() => setEditing({ id: c.id, kind: c.kind, title: c.title, content: c.content ?? "", n: Date.now() })}
                      >
                        {c.kind === "texto" ? "Editar" : "Renombrar"}
                      </ActionButton>
                      <ActionButton icon="trash" danger disabled={busy} onClick={() => setDeleting(c)}>
                        Borrar
                      </ActionButton>
                    </>
                  )}
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={c.active}
                aria-label={c.active ? `Pausar ${c.title}` : `Activar ${c.title}`}
                title={c.active ? "Activo: Claude lo recibe" : "Pausado: Claude no lo recibe"}
                className={`toggle${c.active ? " on" : ""}`}
                disabled={!canEdit || busy}
                onClick={() => run(() => setCriterionActive(c.id, !c.active))}
              />
            </li>
          ))}
        </ul>
      )}

      {uploading && <p className="hint-text crit-status">Subiendo {uploading}…</p>}
      {error && <p className="form-error">{error}</p>}

      {canEdit ? (
        <div className="crit-add">
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={busy}
            onClick={() => setEditing({ id: null, kind: "texto", title: "", content: "", n: Date.now() })}
          >
            <Icon name="plus" size={15} />
            Escribir criterio
          </button>
          <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => fileInput.current?.click()}>
            <Icon name="upload" size={15} />
            Subir archivos
          </button>
          <input
            ref={fileInput}
            type="file"
            accept={CRITERIA_ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) void upload(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      ) : (
        <p className="muted crit-status">Solo un administrador puede cambiar el criterio.</p>
      )}

      {editing && <CriterionDialog key={editing.n} platform={platform} label={label} initial={editing} onClose={() => setEditing(null)} />}
      {deleting && (
        <ConfirmDialog
          key={deleting.id}
          title={`¿Borrar "${deleting.title}"?`}
          confirmLabel={deleting.kind === "texto" ? "Sí, borrar criterio" : "Sí, borrar archivo"}
          onConfirm={() => deleteCriterion(deleting.id)}
          onClose={() => setDeleting(null)}
        >
          Claude deja de tenerlo en cuenta en los próximos análisis de {label}
          {deleting.kind === "archivo" ? " y el archivo se elimina" : ""}. <b>No se puede deshacer.</b> Si solo querés dejar de usarlo por un
          tiempo, pausalo con el interruptor.
        </ConfirmDialog>
      )}
    </Card>
  );
}

function CriterionDialog({
  platform,
  label,
  initial,
  onClose,
}: {
  platform: Platform;
  label: string;
  initial: Editing;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(initial.title);
  const [content, setContent] = useState(initial.content);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isText = initial.kind === "texto";

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const close = () => {
    if (!pending) ref.current?.close();
  };

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!title.trim()) return setError("Poné un título.");
    if (isText && !content.trim()) return setError("Escribí el criterio.");
    startTransition(async () => {
      setError(null);
      const result = await saveCriterion({ id: initial.id, platform, title, content: isText ? content : undefined });
      if (!result.ok) return setError(result.error);
      ref.current?.close();
    });
  }

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="crit-dialog-title"
      onClose={onClose}
      onCancel={(e) => {
        if (pending) e.preventDefault();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className={`modal-card modal-form${isText ? " crit-dialog" : ""}`}>
        <div className="modal-head">
          <h2 id="crit-dialog-title">{initial.id ? (isText ? "Editar criterio" : "Renombrar archivo") : `Criterio de ${label}`}</h2>
          <button type="button" className="modal-close" onClick={close} aria-label="Cerrar">
            ×
          </button>
        </div>
        <form onSubmit={submit} noValidate className="stack-form">
          {isText && !initial.id && (
            <p className="modal-lead">
              Escribilo como se lo explicarías a alguien nuevo en el equipo: qué priorizan, qué evitan, umbrales, estructura de cuenta.
            </p>
          )}
          <label>
            Título
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={MAX_CRITERION_TITLE}
              placeholder={isText ? "Ej.: Estructura de campañas de leads" : undefined}
              autoFocus
              disabled={pending}
            />
          </label>
          {isText && (
            <label>
              Criterio
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                maxLength={MAX_CRITERION_TEXT}
                rows={12}
                placeholder="Ej.: No escalamos más de un 20% el presupuesto por vez. Una campaña de leads con menos de 50 conversiones por semana va con…"
                disabled={pending}
              />
            </label>
          )}
          {error && <p className="form-error modal-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={close} disabled={pending}>
              Cancelar
            </button>
            <button type="submit" className="connect-btn" disabled={pending}>
              {pending ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
