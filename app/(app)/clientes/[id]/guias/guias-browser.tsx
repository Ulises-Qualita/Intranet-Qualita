"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import type { FileKind } from "../drive/drive-browser";

// Video, carpeta o material de apoyo (PDF, etc.), ya listo para mostrar (lo arma guias-view.tsx).
export type GuideItem = {
  id: string;
  name: string;
  kind: FileKind;
  // Carpeta: navega dentro de la intranet. Archivo: descarga (null si no se puede).
  href: string | null;
  // Video: link firmado que se reproduce por tramos (lib/drive-thumb.ts).
  video: string | null;
  thumb: string | null;
  durationMs: number | null;
  // "Abrir en Drive": solo para el equipo.
  openUrl: string | null;
  modifiedLabel: string;
};

// "4:05" o "1:02:30".
function duration(ms: number) {
  const s = Math.round(ms / 1000);
  const [h, m, sec] = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60];
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

// Videoteca de la carpeta de guías: ruta, buscador, subcarpetas (una por
// plataforma, p. ej.), videos en tarjetas 16:9 que se reproducen en un modal, y
// el resto de los archivos como material descargable.
export function GuiasBrowser({ crumbs, items }: { crumbs: { label: string; href: string }[]; items: GuideItem[] }) {
  const [query, setQuery] = useState("");
  const [playing, setPlaying] = useState<GuideItem | null>(null);

  const shown = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("es");
    const list = term ? items.filter((i) => i.name.toLocaleLowerCase("es").includes(term)) : items;
    return [...list].sort((a, b) => a.name.localeCompare(b.name, "es", { numeric: true }));
  }, [items, query]);

  const folders = shown.filter((i) => i.kind === "folder");
  const videos = shown.filter((i) => i.video);
  const others = shown.filter((i) => i.kind !== "folder" && !i.video);

  return (
    <div className="dv gv">
      <div className="dv-bar">
        <nav className="dv-path" aria-label="Ubicación">
          {crumbs.map((c, i) => (
            <span key={c.href}>
              {i > 0 && <Icon name="chevron" size={16} strokeWidth={2} className="dv-path-sep" />}
              {i === crumbs.length - 1 ? <b aria-current="page">{c.label}</b> : <Link href={c.href}>{c.label}</Link>}
            </span>
          ))}
        </nav>
        <div className="dv-tools">
          <label className="dv-search">
            <Icon name="search" size={16} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar una guía" aria-label="Buscar una guía" />
          </label>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="dv-empty">
          <Icon name={query ? "search" : "play"} size={30} />
          <b>{query ? "Nada coincide con la búsqueda" : "Todavía no hay guías acá"}</b>
          <span>{query ? "Probá con otro nombre." : "Cuando el equipo de Qualita suba videos, aparecen en esta pantalla."}</span>
        </div>
      ) : (
        <>
          {folders.length > 0 && (
            <section>
              <h4 className="dv-h">Carpetas</h4>
              <div className="dv-folders">
                {folders.map((f) => (
                  <Link key={f.id} href={f.href!} className="dv-folder" title={f.name}>
                    <Icon name="folder" size={20} />
                    <span>{f.name}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {videos.length > 0 && (
            <section>
              <h4 className="dv-h">
                {videos.length} {videos.length === 1 ? "video" : "videos"}
              </h4>
              <div className="gv-grid">
                {videos.map((v) => (
                  <VideoCard key={v.id} item={v} onPlay={() => setPlaying(v)} />
                ))}
              </div>
            </section>
          )}

          {others.length > 0 && (
            <section>
              <h4 className="dv-h">Material de apoyo</h4>
              <ul className="gv-files">
                {others.map((f) => (
                  <li key={f.id}>
                    <span className={`dv-kind ${f.kind}`} aria-hidden>
                      <Icon name={f.kind === "image" ? "image" : "file-text"} size={15} strokeWidth={2} />
                    </span>
                    <span className="gv-file-name" title={f.name}>
                      {f.name}
                    </span>
                    {f.href && (
                      <a href={f.href} className="dv-act" title="Descargar" aria-label={`Descargar ${f.name}`}>
                        <Icon name="download" size={16} />
                      </a>
                    )}
                    {f.openUrl && (
                      <a href={f.openUrl} target="_blank" rel="noreferrer" className="dv-act" title="Abrir en Drive" aria-label={`Abrir ${f.name} en Drive`}>
                        <Icon name="arrow-out" size={16} strokeWidth={2} />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <Player item={playing} onClose={() => setPlaying(null)} />
    </div>
  );
}

function VideoCard({ item, onPlay }: { item: GuideItem; onPlay: () => void }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className="gv-card">
      <button type="button" className="gv-card-main" onClick={onPlay} aria-label={`Reproducir ${item.name}`}>
        <span className="gv-thumb">
          {item.thumb && !broken ? (
            // eslint-disable-next-line @next/next/no-img-element -- miniatura firmada de Drive, servida por la intranet
            <img src={item.thumb} alt="" loading="lazy" onError={() => setBroken(true)} />
          ) : (
            <span className="gv-thumb-empty" aria-hidden />
          )}
          <span className="gv-play" aria-hidden>
            {/* El triángulo ya está corrido a la derecha dentro del viewBox (centro óptico): no sumar padding. */}
            <svg viewBox="0 0 24 24" width="22" height="22" style={{ display: "block" }}>
              <path d="M8 5.5v13a1 1 0 001.5.86l10.5-6.5a1 1 0 000-1.72L9.5 4.64A1 1 0 008 5.5z" fill="currentColor" />
            </svg>
          </span>
          {item.durationMs ? <span className="gv-dur">{duration(item.durationMs)}</span> : null}
        </span>
        <span className="gv-name" title={item.name}>
          {item.name}
        </span>
      </button>
      <div className="gv-foot">
        <span>{item.modifiedLabel}</span>
        {item.openUrl && (
          <a href={item.openUrl} target="_blank" rel="noreferrer" className="dv-act" title="Abrir en Drive" aria-label={`Abrir ${item.name} en Drive`}>
            <Icon name="arrow-out" size={15} strokeWidth={2} />
          </a>
        )}
      </div>
    </div>
  );
}

// Reproductor en un <dialog>: Esc o clic afuera lo cierran. El <video> se
// desmonta al cerrar, así deja de bajar y de sonar.
function Player({ item, onClose }: { item: GuideItem | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (item && !dialog.open) dialog.showModal();
    if (!item && dialog.open) dialog.close();
  }, [item]);

  return (
    <dialog
      ref={ref}
      className="modal gv-modal"
      aria-label={item?.name ?? "Video"}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {item?.video && (
        <div className="gv-player">
          <div className="gv-player-head">
            <h2>{item.name}</h2>
            <button type="button" className="modal-close" onClick={onClose} aria-label="Cerrar">
              ×
            </button>
          </div>
          <video key={item.id} src={item.video} poster={item.thumb ?? undefined} controls autoPlay playsInline preload="metadata" />
        </div>
      )}
    </dialog>
  );
}
