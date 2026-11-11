import Link from "next/link";
import type { VideoPerformance } from "@/lib/data";
import { compact, dollars, integer, money, orDash, percent, safeDiv } from "@/lib/format";
import { AdThumb } from "../meta/ad-preview";

type Metric = [label: string, value: string];

// Los videos van primero por ventas y después por CPL (topMetaVideos), así que
// se muestran las dos cosas. Sin ventas a la vista (showWon false), solo Meta.
function metrics(v: VideoPerformance, showWon: boolean): Metric[] {
  const ctr = orDash(safeDiv(v.clicks * 100, v.impressions), (x) => percent(x));
  // Siempre, también en $0. Con planilla de ventas, la parte en dólares va aparte.
  const billed: Metric = ["Facturado", [money(v.ticketTotal), v.usdTotal ? dollars(v.usdTotal) : null].filter(Boolean).join(" + ")];
  return [
    ...(showWon ? [["Ventas", integer(v.won)] as Metric, billed] : []),
    ["Leads (Meta)", integer(v.metaLeads)],
    ["CPL", orDash(safeDiv(v.spend, v.metaLeads), (x) => money(x, 2))],
    ["Gasto", money(v.spend)],
    ["CTR", ctr],
    ...(showWon ? [] : [["Impresiones", compact(v.impressions)] as Metric]),
  ];
}

// Aclaración de la card: con qué criterio entraron los videos que se ven.
export function topVideosHint(top: { videos: VideoPerformance[]; bySales: number }, withSales: boolean) {
  if (!withSales) return "según CPL de Meta";
  if (!top.bySales) return "según CPL de Meta (ningún video tiene ventas atribuidas)";
  if (top.bySales === top.videos.length) return "según ventas atribuidas en el CRM";
  return "primero por ventas atribuidas en el CRM, después por CPL de Meta";
}

// Los tres videos que mejor rindieron, con su creativo arriba (se reproduce al
// hacer click) y los números abajo. El orden lo decide topMetaVideos. La usan
// las solapas META y CRM.
export function TopVideos({
  videos,
  showWon,
  clientSlug,
  base,
  query,
  hideMedia = false,
}: {
  videos: VideoPerformance[];
  showWon: boolean;
  clientSlug: string;
  // Ruta de las pestañas del cliente (/clientes/[slug] o /mi-empresa).
  base: string;
  // Período actual (periodQuery), para abrir el anuncio en META con el mismo corte.
  query: string;
  // Sin el creativo, solo los números: el cliente demo (Cliente X) usa datos de
  // otro cliente y sus videos no se muestran.
  hideMedia?: boolean;
}) {
  return (
    <div className="grid g3 top-videos">
      {videos.map((v, i) => (
        <article key={v.ad.id} className="video-tile">
          {hideMedia ? (
            <span className="video-name" title={v.ad.name}>
              {v.ad.name}
            </span>
          ) : (
            <>
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
            </>
          )}
          <dl className="video-stats">
            {metrics(v, showWon).map(([label, value]) => (
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
