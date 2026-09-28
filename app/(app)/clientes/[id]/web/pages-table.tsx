"use client";

import { useState } from "react";

export type PageRow = { url: string; path: string; visits: string; share: string };

const COLLAPSED = 3;

// Páginas más vistas: las primeras 3 y el resto detrás de "Ver más". Las filas
// llegan ya formateadas desde WebView (server).
export function PagesTable({ rows }: { rows: PageRow[] }) {
  const [open, setOpen] = useState(false);
  const visible = open ? rows : rows.slice(0, COLLAPSED);

  return (
    <>
      <div className="table-wrap">
        <table className="ctable">
          <thead>
            <tr>
              <th>Página</th>
              <th>Visitas</th>
              <th>Share</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => (
              <tr key={p.url}>
                <td title={p.url}>{p.path}</td>
                <td>{p.visits}</td>
                <td>{p.share}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > COLLAPSED && (
        <button type="button" className="link-connect" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "Ver menos" : `Ver más (${rows.length - COLLAPSED})`}
        </button>
      )}
    </>
  );
}
