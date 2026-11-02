import { notFound } from "next/navigation";
import { LineChart, StageBars } from "@/components/charts";
import { Icon } from "@/components/icons";
import { SyncStatus } from "@/components/sync-status";
import { Card, ConnectState, EmptyState, Kpi, NoAccess } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { getClient } from "@/lib/data";
import { compact, dollars, integer, percent, shortDate } from "@/lib/format";
import { monthName } from "@/lib/period";
import {
  domainOf,
  getDomainReport,
  getSeRankingReport,
  seRankingConfigured,
  seRankingErrorMessage,
  type SeRankingDomain,
  type SeRankingReport,
  sourceFor,
} from "@/lib/seranking";
import { type KeywordRow, KeywordsTable } from "./keywords-table";
import { RefreshSeRanking } from "./refresh-button";

// La URL de la página que posiciona: en la tabla va solo el camino.
function pagePath(url: string) {
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    return parsed.pathname + parsed.search || "/";
  } catch {
    return url;
  }
}

const decimal = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 1 });
const avg = (list: number[]) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
// "nov 25" para el eje del historial mensual.
const monthLabel = (month: string) => `${monthName(month).slice(0, 3)} ${month.slice(2, 4)}`;

// Solapa SEO (solo equipo). Arriba el rank tracker de SE Ranking (las keywords que
// sigue el proyecto del cliente), después el dominio según la base de SE Ranking
// (tráfico orgánico estimado, backlinks) y al final los competidores del proyecto.
export default async function ClienteSeoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [session, client] = await Promise.all([getAreaSession("clientes"), getClient(id)]);
  if (!session) {
    return (
      <>
        <NoAccess />
      </>
    );
  }
  if (!client) notFound();

  if (!seRankingConfigured()) {
    return (
      <section className="view">
        <EmptyState label="Pendiente">
          Falta la clave de API de SE Ranking: cargala como SERANKING_API_KEY en las variables de entorno.
        </EmptyState>
      </section>
    );
  }
  const state = client.integrations.seranking;
  if (!state.connected || !state.accountRef) {
    return (
      <section className="view">
        <ConnectState kind="seranking" client={client} />
      </section>
    );
  }

  let report: SeRankingReport | null = null;
  let error: string | null = null;
  try {
    report = await getSeRankingReport(state.accountRef);
  } catch (e) {
    console.error("[seranking] report", e);
    error = seRankingErrorMessage(e);
  }

  // El dominio sale de la Data API: si falla, el rank tracker se ve igual.
  const domain = domainOf(report?.site ?? null);
  let site: SeRankingDomain | null = null;
  let siteError: string | null = null;
  if (report && domain) {
    try {
      site = await getDomainReport(domain, sourceFor(report.engine?.label));
    } catch (e) {
      console.error("[seranking] domain", e);
      siteError = seRankingErrorMessage(e);
    }
  }

  const engine = report?.engine?.label ?? "Google";
  const status = (
    <SyncStatus source={`SE Ranking · ${engine}`} live error={error} internal>
      {report?.site?.guestLink && (
        <a className="btn-secondary" href={report.site.guestLink} target="_blank" rel="noreferrer">
          <Icon name="arrow-out" size={15} strokeWidth={2} />
          Abrir en SE Ranking
        </a>
      )}
      <RefreshSeRanking />
    </SyncStatus>
  );

  if (!report || report.keywords.length === 0) {
    return (
      <section className="view">
        {status}
        {!error && <EmptyState label="Sin datos">El proyecto todavía no tiene keywords para seguir en SE Ranking.</EmptyState>}
      </section>
    );
  }

  const keywords = report.keywords;
  const total = keywords.length;
  const ranking = keywords.map((k) => k.position).filter((p): p is number => p !== null);
  const top10 = ranking.filter((p) => p <= 10).length;
  const top3 = ranking.filter((p) => p <= 3).length;
  const avgPos = avg(ranking);

  // Contra una semana atrás (o la primera medición, si el proyecto es más nuevo).
  const days = report.days;
  const weekAgo = days.length > 1 ? days[Math.max(0, days.length - 8)] : null;
  // "el 26 oct eran 2": el valor de entonces, en vez de un "−2" que no se entiende solo.
  const delta = (now: number, before: number | undefined, format: (n: number) => string = integer) => {
    if (before === undefined || !weekAgo) return null;
    return now === before ? `igual que el ${shortDate(weekAgo.date)}` : `el ${shortDate(weekAgo.date)} ${before === 1 ? "era" : "eran"} ${format(before)}`;
  };
  const visBefore = report.visibility.find((v) => weekAgo && v.date === weekAgo.date)?.value;
  // Las 8 keywords con más búsquedas por mes: dónde está la oportunidad más grande.
  const biggest = keywords
    .filter((k) => k.volume)
    .sort((a, b) => b.volume! - a.volume!)
    .slice(0, 8);
  const topVolume = biggest[0]?.volume ?? 1;
  // La mejor posición que alcanzó alguna keyword en los últimos 30 días.
  const best = keywords.filter((k) => k.best !== null).sort((a, b) => a.best! - b.best!)[0] ?? null;

  const rows: KeywordRow[] = keywords.map((k) => ({
    id: k.id,
    name: k.name,
    position: k.position,
    change: k.change,
    best: k.best,
    volume: k.volume,
    map: k.map,
    url: k.url,
    path: k.url ? pagePath(k.url) : "",
  }));

  const buckets = [
    { name: "Top 3", value: top3 },
    { name: "4–10", value: top10 - top3 },
    { name: "11–30", value: ranking.filter((p) => p > 10 && p <= 30).length },
    { name: "31–100", value: ranking.filter((p) => p > 30).length },
    { name: "+100", value: total - ranking.length },
  ];
  // Las búsquedas por mes de las keywords que todavía no están en la primera página.
  const opportunity = keywords.filter((k) => k.position === null || k.position > 10).reduce((s, k) => s + (k.volume ?? 0), 0);

  const competitors = [
    { domain: domain ?? client.name, trust: report.trust, top10, top100: ranking.length, avg: avgPos, own: true },
    ...report.competitors.map((c) => ({ ...c, own: false })),
  ];

  const siteEmpty = site && !site.traffic && !site.keywords && !site.refDomains;

  return (
    <section className="view">
      {status}

      <h2 className="seo-section">
        Posiciones en {engine}
        <span>
          {integer(total)} keywords seguidas
          {report.checkedAt ? ` · medido el ${shortDate(report.checkedAt)}` : ""}
          {report.firstCheck ? ` · desde el ${shortDate(report.firstCheck)}` : ""}
        </span>
      </h2>
      <div className="grid g4 mb-4">
        <Kpi
          label="Visibilidad"
          icon="eye"
          value={report.visibilityNow !== null ? percent(report.visibilityNow) : "—"}
          sub={
            (report.visibilityNow !== null &&
              visBefore !== undefined &&
              delta(report.visibilityNow, visBefore, (n) => percent(n))) ||
            "del tráfico posible de sus keywords"
          }
          hero
        />
        <Kpi
          label="En el top 100"
          icon="target"
          value={`${integer(ranking.length)} de ${integer(total)}`}
          sub={
            [avgPos !== null ? `posición promedio ${decimal(avgPos)}` : null, delta(ranking.length, weekAgo?.top100)]
              .filter(Boolean)
              .join(" · ") || "keywords seguidas"
          }
        />
        <Kpi
          label="En el top 10"
          icon="check"
          value={integer(top10)}
          sub={top3 ? `${integer(top3)} en el top 3` : (delta(top10, weekAgo?.top10) ?? "primera página de Google")}
        />
        <Kpi
          label="Mejor posición del mes"
          icon="bolt"
          value={best ? integer(best.best!) : "—"}
          sub={best ? `«${best.name}»` : "ninguna entró al top 100 en 30 días"}
        />
      </div>

      <div className="grid g-2-1 items-stretch mb-4">
        <Card title="Las búsquedas más grandes" hint={`las ${biggest.length} keywords más buscadas`} className="seo-big-card">
          {biggest.length ? (
            <div className="seo-big">
              <div className="seo-big-row head" aria-hidden>
                <span className="lbl">Keyword</span>
                <span />
                <span className="vol">Búsquedas</span>
                <span className="pos">Posición</span>
              </div>
              {biggest.map((k) => (
                <div key={k.id} className="seo-big-row" title={`${k.name}: ${integer(k.volume ?? 0)} búsquedas por mes`}>
                  <span className="lbl">{k.name}</span>
                  <div className="track">
                    <div className="bar" style={{ width: `${Math.max(2, ((k.volume ?? 0) / topVolume) * 100)}%` }} />
                  </div>
                  <b className="vol">{integer(k.volume ?? 0)}</b>
                  <span className={`pos${k.position === null ? " out" : k.position <= 10 ? " top" : ""}`}>
                    {k.position !== null ? `#${k.position}` : "+100"}
                  </span>
                </div>
              ))}
              <p className="seo-note seo-big-note">
                La barra y el número son cuántas veces por mes se busca cada keyword en {engine}. La posición es dónde
                aparece hoy el sitio en esos resultados: <b>#1</b> es el primer lugar, en color si está en la primera
                página (top 10), y <b>+100</b> quiere decir que no aparece entre los primeros 100.
              </p>
            </div>
          ) : (
            <EmptyState label="Sin datos">SE Ranking no informa el volumen de búsqueda de estas keywords.</EmptyState>
          )}
        </Card>
        <Card title="Distribución" hint="por posición, hoy" className="seo-dist">
          <StageBars stages={buckets} />
          {opportunity > 0 && (
            <p className="seo-note">
              Las keywords fuera del top 10 suman <b>{integer(opportunity)}</b> búsquedas por mes.
            </p>
          )}
        </Card>
      </div>

      <Card title="Keywords" hint={`${integer(total)} seguidas`} className="mb-4">
        <KeywordsTable rows={rows} />
      </Card>

      <h2 className="seo-section">
        El dominio
        <span>
          {domain}
          {site ? " · base de SE Ranking, se actualiza por mes" : ""}
        </span>
      </h2>
      {siteError ? (
        <p className="form-error">{siteError}</p>
      ) : !site ? null : (
        <>
          {siteEmpty && (
            <p className="muted seo-note mb-4">
              SE Ranking todavía no le estima tráfico ni encuentra backlinks a este dominio. Es normal en sitios nuevos o con
              poco tráfico: aparecen cuando empieza a rankear.
            </p>
          )}
          <div className="grid g4 mb-4">
            <Kpi
              label="Tráfico orgánico"
              icon="users"
              value={site.traffic !== null ? compact(site.traffic) : "—"}
              sub={site.trafficValue ? `visitas por mes, valen ${dollars(site.trafficValue)} en anuncios` : "visitas por mes, estimadas"}
            />
            <Kpi
              label="Keywords orgánicas"
              icon="search"
              value={site.keywords !== null ? integer(site.keywords) : "—"}
              sub={
                site.top10 !== null
                  ? `${integer(site.top10)} en el top 10${site.newKeywords ? ` · ${integer(site.newKeywords)} nuevas` : ""}`
                  : "con las que aparece en Google"
              }
            />
            <Kpi
              label="Dominios que enlazan"
              icon="globe"
              value={site.refDomains !== null ? integer(site.refDomains) : "—"}
              sub={site.backlinks !== null ? `${compact(site.backlinks)} backlinks en total` : "backlinks"}
            />
            <Kpi
              label="Autoridad del dominio"
              icon="shield"
              value={report.trust !== null ? integer(report.trust) : "—"}
              sub={report.indexed !== null ? `de 100 · ${integer(report.indexed)} páginas indexadas en Google` : "de 100 (Domain Trust)"}
            />
          </div>
          {site.history.length > 1 && site.history.some((h) => h.traffic > 0) && (
            <Card title="Tráfico orgánico estimado" hint="últimos 12 meses" className="mb-4">
              <LineChart
                id="seo-traffic"
                series={[{ label: "Visitas", data: site.history.map((h) => h.traffic), color: "#B50CC5", fillOpacity: 0.18 }]}
                labels={site.history.map((h) => monthLabel(h.month))}
              />
            </Card>
          )}
        </>
      )}

      {report.competitors.length > 0 && (
        <Card title="Competidores" hint={`en las ${integer(total)} keywords del proyecto · ${engine}`}>
          <div className="table-wrap">
            <table className="ctable">
              <thead>
                <tr>
                  <th>Sitio</th>
                  <th>Top 10</th>
                  <th>Top 100</th>
                  <th>Posición promedio</th>
                  <th>Autoridad</th>
                </tr>
              </thead>
              <tbody>
                {competitors.map((c) => (
                  <tr key={c.domain} className={c.own ? "seo-own" : undefined}>
                    <td>
                      <b>{c.domain}</b>
                      {c.own && <span className="seo-map">Este cliente</span>}
                    </td>
                    <td className="num">{integer(c.top10)}</td>
                    <td className="num">{integer(c.top100)}</td>
                    <td className="num">{c.avg !== null ? decimal(c.avg) : <span className="muted">—</span>}</td>
                    <td className="num">{c.trust !== null ? integer(c.trust) : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </section>
  );
}
