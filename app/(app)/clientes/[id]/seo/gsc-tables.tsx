"use client";

import { useState } from "react";

export type GscTableRow = {
  key: string;
  // Para las páginas: el camino que se muestra (la URL entera va en el link).
  label: string;
  url?: string;
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
  // Lugares que ganó contra el período anterior (positivo = subió). null = sin dato.
  change: number | null;
};

type Filter = { id: string; label: string; test: (r: GscTableRow) => boolean };

const QUERY_FILTERS: Filter[] = [
  { id: "all", label: "Todas", test: () => true },
  { id: "top3", label: "Top 3", test: (r) => r.position !== null && r.position <= 3.5 },
  { id: "top10", label: "Primera página", test: (r) => r.position !== null && r.position <= 10.5 },
  // Las que están cerca de la primera página: donde un empujón rinde más.
  { id: "near", label: "Cerca (11–20)", test: (r) => r.position !== null && r.position > 10.5 && r.position <= 20.5 },
  { id: "noclicks", label: "Sin clics", test: (r) => r.clicks === 0 },
];
const ALL: Filter[] = [QUERY_FILTERS[0]];

type SortKey = "clicks" | "impressions" | "ctr" | "position" | "change";
const COLLAPSED = 15;
const fmt = (n: number) => n.toLocaleString("es-AR");
const dec = (n: number) => n.toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Búsquedas o páginas de Search Console. Por defecto, de más a menos clics.
export function GscTable({ rows, kind }: { rows: GscTableRow[]; kind: "query" | "page" }) {
  const filters = kind === "query" ? QUERY_FILTERS : ALL;
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState<SortKey>("clicks");
  const [open, setOpen] = useState(false);

  const test = filters.find((f) => f.id === filter)?.test ?? (() => true);
  const sorted = rows.filter(test).sort((a, b) => {
    if (sort === "position") return (a.position ?? 1e9) - (b.position ?? 1e9);
    if (sort === "change") return (b.change ?? -1e9) - (a.change ?? -1e9);
    if (sort === "ctr") return (b.ctr ?? -1) - (a.ctr ?? -1);
    if (sort === "impressions") return b.impressions - a.impressions;
    return b.clicks - a.clicks || b.impressions - a.impressions;
  });
  const visible = open ? sorted : sorted.slice(0, COLLAPSED);

  const header = (key: SortKey, label: string) => (
    <th aria-sort={sort === key ? (key === "position" ? "ascending" : "descending") : undefined}>
      <button type="button" className={`seo-sort${sort === key ? " on" : ""}`} onClick={() => setSort(key)}>
        {label}
      </button>
    </th>
  );

  return (
    <>
      {filters.length > 1 && (
        <div className="chips seo-filters" role="group" aria-label="Filtrar búsquedas">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`chip${filter === f.id ? " on" : ""}`}
              onClick={() => {
                setFilter(f.id);
                setOpen(false);
              }}
              aria-pressed={filter === f.id}
            >
              {f.label} <span>{rows.filter(f.test).length}</span>
            </button>
          ))}
        </div>
      )}

      {sorted.length === 0 ? (
        <p className="muted seo-none">Nada en este grupo.</p>
      ) : (
        <div className="table-wrap">
          <table className="ctable seo-table">
            <thead>
              <tr>
                <th>{kind === "query" ? "Búsqueda" : "Página"}</th>
                {header("clicks", "Clics")}
                {header("impressions", "Impresiones")}
                {header("ctr", "CTR")}
                {header("position", "Posición")}
                {header("change", "Cambio")}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.key}>
                  {kind === "page" ? (
                    <td className="seo-page" title={r.url}>
                      <a href={r.url} target="_blank" rel="noreferrer">
                        {r.label}
                      </a>
                    </td>
                  ) : (
                    <td>
                      <b>{r.label}</b>
                    </td>
                  )}
                  <td className="num">{fmt(r.clicks)}</td>
                  <td className="num">{fmt(r.impressions)}</td>
                  <td className="num">{r.ctr !== null ? `${dec(r.ctr)}%` : <span className="muted">—</span>}</td>
                  <td className="num">
                    {r.position !== null ? (
                      <b className={r.position <= 10.5 ? "seo-top" : undefined}>{dec(r.position)}</b>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="num">
                    {r.change === null ? (
                      <span className="muted" title="No apareció en el período anterior">
                        Nueva
                      </span>
                    ) : Math.abs(r.change) >= 0.5 ? (
                      <span className={r.change > 0 ? "seo-up" : "seo-down"}>
                        {r.change > 0 ? "▲" : "▼"} {dec(Math.abs(r.change))}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {sorted.length > COLLAPSED && (
        <button type="button" className="link-connect" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "Ver menos" : `Ver todas (${sorted.length})`}
        </button>
      )}
    </>
  );
}
