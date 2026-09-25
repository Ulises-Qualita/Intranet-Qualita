import Link from "next/link";
import type { VideoPerformance } from "@/lib/data";
import { compact, integer, money, orDash, percent, safeDiv } from "@/lib/format";
import { AdThumb } from "../meta/ad-preview";

type Metric = [label: string, value: string];

function metrics(v: VideoPerformance, by: "crm" | "meta", showWon: boolean): Metric[] {
  const ctr = orDash(safeDiv(v.clicks * 100, v.impressions), (x) => percent(x));
  if (by === "meta") {
    return [
      ["Leads (Meta)", integer(v.metaLeads)],
      ["CPL", orDash(safeDiv(v.spend, v.metaLeads), (x) => money(x, 2))],
      ["Gasto", money(v.spend)],
      ["CTR", ctr],
      ["Impresiones", compact(v.impressions)],
    ];
  }
  return [
    ["Oportunidades", integer(v.crmLeads)],
    ...(showWon ? [["Ganadas", integer(v.won)] as Metric] : []),
    ["Facturado", v.ticketTotal ? money(v.ticketTotal) : "—"],
    ["Gasto", money(v.spend)],
    ["Costo por oportunidad", orDash(safeDiv(v.spend, v.crmLeads), (x) => money(x, 2))],
    ["CTR", ctr],
  ];
}

// Los tres videos que mejor rindieron, con su creativo arriba (se reproduce al
// hacer click) y los números abajo. El orden lo decide topVideoAds.
export function TopVideos({
  videos,
  by,
  showWon,
  clientSlug,
  base,
  query,
}: {
  videos: VideoPerformance[];
  by: "crm" | "meta";
  showWon: boolean;
  clientSlug: string;
  // Ruta de las pestañas del cliente (/clientes/[slug] o /mi-empresa).
  base: string;
  // Período actual (periodQuery), para abrir el anuncio en META con el mismo corte.
  query: string;
}) {
  return (
    <div className="grid g3 top-videos">
      {videos.map((v, i) => (
        <article key={v.ad.id} className="video-tile">
          <div className="video-media">
            <AdThumb ad={v.ad} clientSlug={clientSlug} size="lg" />
            <span className="video-rank">#{i + 1}</span>
          </div>
          <Link
            className="video-name"
            href={`${base}/meta?${query}&anuncio=${encodeURIComponent(v.ad.name)}`}
            title={`${v.ad.name} · ver en META`}
          >
            {v.ad.name}
          </Link>
          <dl className="video-stats">
            {metrics(v, by, showWon).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </article>
      ))}
    </div>
  );
}
