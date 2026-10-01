"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Icon, type IconName } from "@/components/icons";
import { DriveUploader } from "./drive-uploader";

// Tipo de archivo para el ícono de color, como en Google Drive.
export type FileKind = "folder" | "pdf" | "doc" | "sheet" | "slide" | "image" | "video" | "audio" | "zip" | "file";

// Archivo o carpeta ya listo para mostrar (lo arma drive-view.tsx en el server).
export type BrowserItem = {
  id: string;
  name: string;
  kind: FileKind;
  // Carpeta: navega dentro de la intranet. Archivo: descarga (null si no se puede).
  href: string | null;
  // Miniatura firmada (lib/drive-thumb.ts), o null.
  thumb: string | null;
  // "Abrir en Drive": solo para el equipo.
  openUrl: string | null;
  modified: string | null;
  modifiedLabel: string;
  size: number | null;
  sizeLabel: string;
};

// Ícono y nombre de cada tipo; el color lo pone el CSS (.dv-kind.<tipo>).
const KINDS: Record<FileKind, { icon: IconName; label: string }> = {
  folder: { icon: "folder", label: "Carpeta" },
  pdf: { icon: "file-text", label: "PDF" },
  doc: { icon: "file-text", label: "Documento" },
  sheet: { icon: "table", label: "Hoja de cálculo" },
  slide: { icon: "slides", label: "Presentación" },
  image: { icon: "image", label: "Imagen" },
  video: { icon: "play", label: "Video" },
  audio: { icon: "music", label: "Audio" },
  zip: { icon: "archive", label: "Archivo comprimido" },
  file: { icon: "file", label: "Archivo" },
};

type Sort = { by: "name" | "modified" | "size"; dir: 1 | -1 };
type View = "grid" | "list";
const VIEW_KEY = "drive-view";

// Explorador de la carpeta de un cliente, con la forma de Google Drive: ruta
// arriba, buscador, vista de cuadrícula (carpetas y archivos con miniatura) o de
// lista, y subida. La vista elegida se recuerda en el navegador.
export function DriveBrowser({
  crumbs,
  items,
  upload,
}: {
  crumbs: { label: string; href: string }[];
  items: BrowserItem[];
  upload: { slug: string | null; folderId: string; folderName: string };
}) {
  const [view, setView] = useState<View>("grid");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>({ by: "name", dir: 1 });

  // Preferencia por navegador; si el storage no está disponible, queda la cuadrícula.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- se lee una vez al montar, después de hidratar
      if (saved === "grid" || saved === "list") setView(saved);
    } catch {}
  }, []);
  function changeView(next: View) {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {}
  }

  const shown = useMemo(() => {
    const term = query.trim().toLocaleLowerCase("es");
    const list = term ? items.filter((i) => i.name.toLocaleLowerCase("es").includes(term)) : items;
    const value = (i: BrowserItem) => (sort.by === "name" ? i.name : sort.by === "modified" ? (i.modified ?? "") : (i.size ?? -1));
    // Las carpetas siempre primero, como en Drive.
    return [...list].sort((a, b) => {
      if ((a.kind === "folder") !== (b.kind === "folder")) return a.kind === "folder" ? -1 : 1;
      const [x, y] = [value(a), value(b)];
      const cmp = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "es", { numeric: true });
      return cmp * sort.dir;
    });
  }, [items, query, sort]);

  const folders = shown.filter((i) => i.kind === "folder");
  const files = shown.filter((i) => i.kind !== "folder");
  const toggleSort = (by: Sort["by"]) => setSort((s) => (s.by === by ? { by, dir: s.dir === 1 ? -1 : 1 } : { by, dir: by === "name" ? 1 : -1 }));

  return (
    <div className="dv">
      <div className="dv-bar">
        <nav className="dv-path" aria-label="Ubicación">
          {crumbs.map((c, i) => (
            <span key={c.href}>
              {i > 0 && <Icon name="chevron" size={16} strokeWidth={2} className="dv-path-sep" />}
              {i === crumbs.length - 1 ? (
                <b aria-current="page">{c.label}</b>
              ) : (
                <Link href={c.href}>{c.label}</Link>
              )}
            </span>
          ))}
        </nav>

        <div className="dv-tools">
          <label className="dv-search">
            <Icon name="search" size={16} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar en esta carpeta"
              aria-label="Buscar en esta carpeta"
            />
          </label>
          <div className="dv-views" role="group" aria-label="Vista">
            <button type="button" className={view === "grid" ? "on" : undefined} onClick={() => changeView("grid")} aria-pressed={view === "grid"} title="Cuadrícula">
              <Icon name="grid" size={16} />
            </button>
            <button type="button" className={view === "list" ? "on" : undefined} onClick={() => changeView("list")} aria-pressed={view === "list"} title="Lista">
              <Icon name="list" size={16} />
            </button>
          </div>
          <DriveUploader {...upload} />
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="dv-empty">
          <Icon name={query ? "search" : "folder"} size={30} />
          <b>{query ? "Nada coincide con la búsqueda" : "Esta carpeta está vacía"}</b>
          <span>{query ? "Probá con otro nombre." : "Subí archivos con el botón o arrastralos a la pantalla."}</span>
        </div>
      ) : view === "grid" ? (
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
          {files.length > 0 && (
            <section>
              <h4 className="dv-h">Archivos</h4>
              <div className="dv-files">
                {files.map((f) => (
                  <FileCard key={f.id} item={f} />
                ))}
              </div>
            </section>
          )}
        </>
      ) : (
        <div className="table-wrap">
          <table className="dv-table">
            <thead>
              <tr>
                <SortTh label="Nombre" by="name" sort={sort} onSort={toggleSort} />
                <SortTh label="Última modificación" by="modified" sort={sort} onSort={toggleSort} />
                <SortTh label="Tamaño" by="size" sort={sort} onSort={toggleSort} />
                <th aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {shown.map((f) => (
                <tr key={f.id}>
                  <td>
                    <ItemLink item={f} className="dv-row-name">
                      <KindIcon kind={f.kind} />
                      <span>{f.name}</span>
                    </ItemLink>
                  </td>
                  <td className="dv-muted">{f.modifiedLabel}</td>
                  <td className="dv-muted">{f.sizeLabel}</td>
                  <td className="dv-acts">
                    <Actions item={f} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SortTh({ label, by, sort, onSort }: { label: string; by: Sort["by"]; sort: Sort; onSort: (by: Sort["by"]) => void }) {
  const active = sort.by === by;
  return (
    <th aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
      <button type="button" className={`dv-sort${active ? " on" : ""}`} onClick={() => onSort(by)}>
        {label}
        {active && <span aria-hidden>{sort.dir === 1 ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}

// Ícono del tipo sobre un cuadrado suave de su color; el nombre del tipo, como tooltip.
function KindIcon({ kind }: { kind: FileKind }) {
  return (
    <span className={`dv-kind ${kind}`} title={KINDS[kind].label} aria-hidden>
      <Icon name={KINDS[kind].icon} size={15} strokeWidth={2} />
    </span>
  );
}

// Carpetas: link interno. Archivos: descarga directa. Sin href, texto.
function ItemLink({ item, className, children }: { item: BrowserItem; className: string; children: React.ReactNode }) {
  if (!item.href) return <span className={className}>{children}</span>;
  return item.kind === "folder" ? (
    <Link href={item.href} className={className}>
      {children}
    </Link>
  ) : (
    <a href={item.href} className={className}>
      {children}
    </a>
  );
}

function Actions({ item }: { item: BrowserItem }) {
  return (
    <>
      {item.kind !== "folder" && item.href && (
        <a href={item.href} className="dv-act" title="Descargar" aria-label={`Descargar ${item.name}`}>
          <Icon name="download" size={16} />
        </a>
      )}
      {item.openUrl && (
        <a href={item.openUrl} target="_blank" rel="noreferrer" className="dv-act" title="Abrir en Drive" aria-label={`Abrir ${item.name} en Drive`}>
          <Icon name="arrow-out" size={16} strokeWidth={2} />
        </a>
      )}
    </>
  );
}

function FileCard({ item }: { item: BrowserItem }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className="dv-card">
      <ItemLink item={item} className="dv-card-main">
        <span className={`dv-thumb ${item.kind}`}>
          {item.thumb && !broken ? (
            // eslint-disable-next-line @next/next/no-img-element -- miniatura firmada de Drive, servida por la intranet
            <img src={item.thumb} alt="" loading="lazy" onError={() => setBroken(true)} />
          ) : (
            <span className="dv-thumb-kind" aria-hidden>
              <Icon name={KINDS[item.kind].icon} size={40} strokeWidth={1.6} />
            </span>
          )}
        </span>
        <span className="dv-card-name">
          <KindIcon kind={item.kind} />
          <span title={item.name}>{item.name}</span>
        </span>
      </ItemLink>
      <div className="dv-card-foot">
        <span>{item.modifiedLabel}</span>
        <span className="dv-card-acts">
          <Actions item={item} />
        </span>
      </div>
    </div>
  );
}
