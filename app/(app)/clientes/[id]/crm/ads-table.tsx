"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/icons";
import type { AdStats } from "@/lib/data";
import { integer, money } from "@/lib/format";

// Cuántos anuncios se ven antes de pedir el resto.
const PREVIEW = 4;

// Anuncios que el CRM atribuye a cada oportunidad. Cada fila abre el anuncio en
// la vista de META, con su campaña ya desplegada.
// `query` es el período actual (periodQuery): el anuncio se abre en META con el mismo corte.
// `base` es la ruta de las pestañas del cliente (/clientes/[slug] o /mi-empresa).
export function AdsTable({ ads, base, query }: { ads: AdStats[]; base: string; query: string }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? ads : ads.slice(0, PREVIEW);
  const hidden = ads.length - visible.length;

  return (
    <>
      <div className="table-wrap">
        <table className="ctable">
          <thead>
            <tr>
              <th>Anuncio</th>
              <th>Leads</th>
              <th>Ganadas</th>
              <th>Facturado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((ad) => {
              const href = `${base}/meta?${query}&anuncio=${encodeURIComponent(ad.name)}`;
              return (
                <tr key={ad.name} className="link-row">
                  <td>
                    <Link href={href} title={ad.name}>
                      <b>{ad.name}</b>
                    </Link>
                  </td>
                  <td className="num">{integer(ad.leads)}</td>
                  <td className="num">{integer(ad.won)}</td>
                  <td className="num">{ad.ticketTotal ? money(ad.ticketTotal) : "—"}</td>
                  <td className="go">
                    <Link href={href} aria-label={`Ver ${ad.name} en META`}>
                      <Icon name="chevron" size={18} strokeWidth={2} />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {ads.length > PREVIEW && (
        <button type="button" className="link-connect mt-4" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Ver menos" : `Ver ${hidden} anuncios más`}
        </button>
      )}
    </>
  );
}
