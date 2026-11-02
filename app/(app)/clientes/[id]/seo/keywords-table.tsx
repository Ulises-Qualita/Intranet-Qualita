"use client";

import { useState } from "react";

export type KeywordRow = {
  id: string;
  name: string;
  // null = fuera del top 100.
  position: number | null;
  change: number | null;
  best: number | null;
  volume: number | null;
  map: number | null;
  url: string | null;
  path: string;
};

const FILTERS = [
  { id: "all", label: "Todas", test: () => true },
  { id: "top10", label: "Top 10", test: (k: KeywordRow) => k.position !== null && k.position <= 10 },
  // Las que están cerca de la primera página: donde un empujón rinde más.
  { id: "near", label: "Cerca del top 10 (11–30)", test: (k: KeywordRow) => k.position !== null && k.position > 10 && k.position <= 30 },
  { id: "ranked", label: "En el top 100", test: (k: KeywordRow) => k.position !== null },
  { id: "out", label: "Sin posicionar", test: (k: KeywordRow) => k.position === null },
] as const;
type FilterId = (typeof FILTERS)[number]["id"];
type SortKey = "position" | "volume" | "change";

const COLLAPSED = 15;
const fmt = (n: number) => n.toLocaleString("es-AR");

// Keywords del proyecto. Por defecto, de la mejor posición a la peor y, entre las
// que no rankean, de más a menos búsquedas (las oportunidades más grandes primero).
export function KeywordsTable({ rows }: { rows: KeywordRow[] }) {
  const [filter, setFilter] = useState<FilterId>("all");
  const [sort, setSort] = useState<SortKey>("position");
  const [open, setOpen] = useState(false);

  const test = FILTERS.find((f) => f.id === filter)!.test;
  const sorted = rows.filter(test).sort((a, b) => {
    if (sort === "volume") return (b.volume ?? -1) - (a.volume ?? -1);
    if (sort === "change") return (b.change ?? 0) - (a.change ?? 0) || (a.position ?? 1e9) - (b.position ?? 1e9);
    return (a.position ?? 1e9) - (b.position ?? 1e9) || (b.volume ?? -1) - (a.volume ?? -1);
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
      <div className="chips seo-filters" role="group" aria-label="Filtrar keywords">
        {FILTERS.map((f) => {
          const count = rows.filter(f.test).length;
          return (
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
              {f.label} <span>{count}</span>
            </button>
          );
        })}
      </div>

      {sorted.length === 0 ? (
        <p className="muted seo-none">Ninguna keyword en este grupo.</p>
      ) : (
        <div className="table-wrap">
          <table className="ctable seo-table">
            <thead>
              <tr>
                <th>Keyword</th>
                {header("position", "Posición")}
                {header("change", "Cambio")}
                <th>Mejor (30 días)</th>
                {header("volume", "Búsquedas/mes")}
                <th>Página</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((k) => (
                <tr key={k.id}>
                  <td>
                    <b>{k.name}</b>
                    {k.map && <span className="seo-map">Mapa #{k.map}</span>}
                  </td>
                  <td className="num">
                    {k.position !== null ? (
                      <b className={k.position <= 10 ? "seo-top" : undefined}>{k.position}</b>
                    ) : (
                      <span className="muted" title="No aparece en los primeros 100 resultados">
                        +100
                      </span>
                    )}
                  </td>
                  <td className="num">
                    {k.change ? (
                      <span className={k.change > 0 ? "seo-up" : "seo-down"}>
                        {k.change > 0 ? "▲" : "▼"} {Math.abs(k.change)}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="num">{k.best !== null ? k.best : <span className="muted">—</span>}</td>
                  <td className="num">{k.volume !== null ? fmt(k.volume) : <span className="muted">—</span>}</td>
                  <td className="seo-page" title={k.url ?? undefined}>
                    {k.url ? (
                      <a href={k.url} target="_blank" rel="noreferrer">
                        {k.path}
                      </a>
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
