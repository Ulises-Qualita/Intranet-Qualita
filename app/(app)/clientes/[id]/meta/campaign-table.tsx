"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";
import { Pill } from "@/components/ui";
import type { MetaAd, MetaCampaign } from "@/lib/data";
import { compact, integer, money, orDash, percent, safeDiv } from "@/lib/format";
import { AdThumb } from "./ad-preview";

const StatusPill = ({ status }: { status: string }) =>
  status === "activo" ? <Pill variant="activo">Activo</Pill> : <Pill variant="pausado">Pausado</Pill>;

// Las cuatro columnas numéricas se calculan igual para campañas y anuncios.
function Numbers({ row }: { row: MetaAd }) {
  return (
    <>
      <td className="num">{money(row.spend)}</td>
      <td className="num">{integer(row.leads)}</td>
      <td className="num">{orDash(safeDiv(row.spend, row.leads), (v) => money(v, 2))}</td>
      <td>{orDash(safeDiv(row.clicks * 100, row.impressions), (v) => percent(v))}</td>
      <td>{compact(row.impressions)}</td>
    </>
  );
}

// Tabla de campañas: cada fila se despliega y muestra sus anuncios.
//
// `highlight` llega desde la vista de CRM (?anuncio=): abre la campaña de ese
// anuncio y lo resalta, para no tener que buscarlo a mano entre todas.
export function CampaignTable({
  campaigns,
  clientSlug,
  highlight,
}: {
  campaigns: MetaCampaign[];
  clientSlug: string;
  highlight?: string;
}) {
  const [open, setOpen] = useState<string[]>(() =>
    highlight ? campaigns.filter((c) => c.ads.some((a) => a.name === highlight)).map((c) => c.id) : [],
  );

  const toggle = (id: string) => setOpen((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  return (
    <div className="table-wrap">
      <table className="ctable">
        <thead>
          <tr>
            <th>Campaña</th>
            <th>Estado</th>
            <th>Gasto</th>
            <th>Leads</th>
            <th>CPL</th>
            <th>CTR</th>
            <th>Impresiones</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((campaign) => {
            const expanded = open.includes(campaign.id);
            return [
              <tr key={campaign.id} className="camp-row">
                <td>
                  <button type="button" className="camp-toggle" aria-expanded={expanded} onClick={() => toggle(campaign.id)}>
                    <Icon name="chevron" size={15} strokeWidth={2} className={`chev${expanded ? " on" : ""}`} />
                    <b>{campaign.name}</b>
                    <span className="camp-count">
                      {campaign.ads.length} {campaign.ads.length === 1 ? "anuncio" : "anuncios"}
                    </span>
                  </button>
                </td>
                <td>
                  <StatusPill status={campaign.status} />
                </td>
                <Numbers row={campaign} />
              </tr>,
              ...(expanded
                ? campaign.ads.map((ad) => (
                    <tr key={`${campaign.id}-${ad.id}`} className={`ad-row${ad.name === highlight ? " on" : ""}`}>
                      <td>
                        <div className="cl-cell">
                          <AdThumb ad={ad} clientSlug={clientSlug} />
                          <b>{ad.name}</b>
                        </div>
                      </td>
                      <td>
                        <StatusPill status={ad.status} />
                      </td>
                      <Numbers row={ad} />
                    </tr>
                  ))
                : []),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}
