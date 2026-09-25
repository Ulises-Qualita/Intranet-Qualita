"use client";

import { useRef, useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import type { MetaAd } from "@/lib/data";
import type { AdPreview } from "@/lib/meta";
import { loadAdPreview } from "./actions";

type Ad = Pick<MetaAd, "name" | "externalId" | "creative">;

function Thumb({ ad }: { ad: Ad }) {
  return (
    <>
      {ad.creative?.thumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element -- miniatura en el CDN de Meta, URL firmada que vence
        <img src={ad.creative.thumbnail} alt="" loading="lazy" />
      ) : (
        <Icon name="media" />
      )}
      {ad.creative?.type === "video" && (
        <span className="play" aria-hidden>
          <svg viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" fill="currentColor" />
          </svg>
        </span>
      )}
    </>
  );
}

// Miniatura del creativo. Al hacer click abre la vista previa oficial de Meta,
// que reproduce los videos. `size` elige entre la miniatura de la tabla y la
// grande de la card del CRM.
export function AdThumb({ ad, clientSlug, size = "sm" }: { ad: Ad; clientSlug: string; size?: "sm" | "lg" }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [preview, setPreview] = useState<AdPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const className = size === "lg" ? "ad-thumb-lg" : "thumb-sm ad-thumb";

  // Sin id de Meta no hay a quién pedirle la vista previa.
  if (!ad.externalId) {
    return (
      <div className={className}>
        <Thumb ad={ad} />
      </div>
    );
  }
  const adId = ad.externalId;

  function open() {
    dialogRef.current?.showModal();
    if (preview || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await loadAdPreview(clientSlug, adId);
      if (result.ok) setPreview(result.preview);
      else setError(result.error);
    });
  }

  return (
    <>
      <button type="button" className={className} onClick={open} aria-label={`Ver el anuncio ${ad.name}`}>
        <Thumb ad={ad} />
      </button>

      <dialog
        ref={dialogRef}
        className="modal"
        aria-label={`Vista previa de ${ad.name}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) dialogRef.current?.close();
        }}
      >
        <div className="modal-card preview-card">
          <div className="preview-head">
            <b title={ad.name}>{ad.name}</b>
            <button type="button" className="icon-btn" onClick={() => dialogRef.current?.close()} aria-label="Cerrar">
              <Icon name="close" size={18} />
            </button>
          </div>
          {preview ? (
            <iframe
              src={preview.src}
              width={preview.width}
              height={preview.height}
              title={`Vista previa de ${ad.name}`}
              allow="autoplay; encrypted-media; fullscreen"
              sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            />
          ) : error ? (
            <p className="form-error">{error}</p>
          ) : (
            <div className="preview-loading" role="status">
              <div className="skel" />
              <span>Cargando vista previa…</span>
            </div>
          )}
        </div>
      </dialog>
    </>
  );
}
