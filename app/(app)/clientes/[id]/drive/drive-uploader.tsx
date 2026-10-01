"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { createDriveUpload } from "./actions";

type Upload = { key: string; name: string; progress: number; error: string | null; done: boolean };

// Sube archivos a la carpeta que se está mirando: con el botón o soltándolos en
// cualquier parte de la pantalla. Cada archivo pide su URL de subida al server
// (que valida que la carpeta sea del cliente) y va directo a Google Drive.
export function DriveUploader({ slug, folderId, folderName }: { slug: string | null; folderId: string; folderName: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const busy = uploads.some((u) => !u.done && !u.error);

  const patch = (key: string, change: Partial<Upload>) =>
    setUploads((list) => list.map((u) => (u.key === key ? { ...u, ...change } : u)));

  async function uploadOne(file: File) {
    const key = `${file.name}-${file.size}-${Math.random()}`;
    setUploads((list) => [...list, { key, name: file.name, progress: 0, error: null, done: false }]);

    const start = await createDriveUpload(slug, folderId, { name: file.name, size: file.size, type: file.type });
    if (!start.ok) return patch(key, { error: start.error });

    // XHR y no fetch: fetch no informa el progreso de una subida.
    await new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", start.url);
      xhr.upload.onprogress = (e) => e.lengthComputable && patch(key, { progress: e.loaded / e.total });
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) patch(key, { progress: 1, done: true });
        else patch(key, { error: `Google Drive respondió ${xhr.status}` });
        resolve();
      };
      xhr.onerror = () => {
        patch(key, { error: "Se cortó la conexión durante la subida." });
        resolve();
      };
      xhr.send(file);
    });
  }

  async function upload(files: FileList | File[]) {
    const list = [...files];
    if (!list.length) return;
    // De a uno: con archivos grandes, en paralelo se pisan el ancho de banda.
    for (const file of list) await uploadOne(file);
    router.refresh();
  }

  // Soltar archivos en cualquier parte de la pantalla.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files");
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      if (e.dataTransfer?.files.length) void upload(e.dataTransfer.files);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
    // upload cambia en cada render; la carpeta es lo único que importa acá.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderId]);

  return (
    <>
      <button type="button" className="btn-secondary" onClick={() => input.current?.click()} disabled={busy}>
        <Icon name="upload" size={15} strokeWidth={2} />
        {busy ? "Subiendo…" : "Subir archivos"}
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void upload(e.target.files);
          e.target.value = "";
        }}
      />

      {uploads.length > 0 && (
        <div className="drive-uploads" role="status">
          <div className="drive-uploads-h">
            <b>{busy ? "Subiendo archivos" : "Subida terminada"}</b>
            {!busy && (
              <button type="button" className="icon-btn" onClick={() => setUploads([])} aria-label="Cerrar">
                <Icon name="close" size={15} />
              </button>
            )}
          </div>
          <ul>
            {uploads.map((u) => (
              <li key={u.key} className={u.error ? "err" : u.done ? "ok" : undefined}>
                <span className="drive-up-name" title={u.name}>
                  {u.name}
                </span>
                <span className="drive-up-state">
                  {u.error ?? (u.done ? "Listo" : `${Math.round(u.progress * 100)}%`)}
                </span>
                {!u.error && !u.done && (
                  <span className="drive-up-bar" style={{ "--p": u.progress } as React.CSSProperties} aria-hidden />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {dragging && (
        <div className="drive-drop" aria-hidden>
          <div>
            <Icon name="upload" size={30} />
            <b>Soltá para subir a «{folderName}»</b>
          </div>
        </div>
      )}
    </>
  );
}
