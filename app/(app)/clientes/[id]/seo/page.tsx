import { notFound } from "next/navigation";
import { LineChart, StageBars } from "@/components/charts";
import { Icon } from "@/components/icons";
import { SyncStatus } from "@/components/sync-status";
import { Card, ConnectState, EmptyState, Kpi, NoAccess, Pill } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { type Better, compare } from "@/lib/compare";
import { getClient } from "@/lib/data";
import { compact, integer, localDate, orDash, percent, shortDate } from "@/lib/format";
import { periodPhrase, readPeriod } from "@/lib/period";
import {
  countryName,
  DEVICES,
  type GscMetrics,
  type GscReport,
  type GscRow,
  getSearchConsoleReport,
  searchConsoleConfigured,
  searchConsoleErrorMessage,
  searchConsoleUrl,
  siteLabel,
} from "@/lib/search-console";
import { GscTable, type GscTableRow } from "./gsc-tables";
import { RefreshSearchConsole } from "./refresh-button";

// El camino de una URL, para la tabla de páginas.
function pagePath(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.pathname + parsed.search || "/";
  } catch {
    return url;
  }
}

const decimal = (n: number) => n.toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const range = (since: string, until: string) => (since === until ? shortDate(since) : `${shortDate(since)} – ${shortDate(until)}`);

const toRow = (r: GscRow, label = r.key, url?: string): GscTableRow => ({
  key: r.key,
  label,
  url,
  clicks: r.clicks,
  impressions: r.impressions,
  ctr: r.ctr,
  position: r.position,
  change: r.prevPosition !== null && r.position !== null ? r.prevPosition - r.position : null,
});

// Barras horizontales con el reparto de clics (dispositivos, países).
function Share({ rows, name }: { rows: GscRow[]; name: (key: string) => string }) {
  const total = rows.reduce((a, r) => a + r.clicks, 0);
  const top = Math.max(1, ...rows.map((r) => r.clicks));
  return (
    <div className="seo-big">
      <div className="seo-big-row head" aria-hidden>
        <span className="lbl" />
        <span />
        <span className="vol">Clics</span>
        <span className="pos">Parte</span>
      </div>
      {rows.map((r) => (
        <div
          key={r.key}
          className="seo-big-row"
          title={`${name(r.key)}: ${integer(r.clicks)} clics, ${integer(r.impressions)} impresiones`}
        >
          <span className="lbl">{name(r.key)}</span>
          <div className="track">
            <div className="bar" style={{ width: `${Math.max(2, (r.clicks / top) * 100)}%` }} />
          </div>
          <b className="vol">{integer(r.clicks)}</b>
          <span className="pos">{total ? percent((r.clicks / total) * 100, 0) : "—"}</span>
        </div>
      ))}
    </div>
  );
}

// Solapa SEO (solo equipo): el rendimiento del sitio en la búsqueda de Google según
// Search Console, en el período del encabezado. Sin loading.tsx, como las demás
// solapas con período.
export default async function ClienteSeoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mes?: string; dias?: string; desde?: string; hasta?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const [session, client] = await Promise.all([getAreaSession("clientes"), getClient(id)]);
  if (!session) return <NoAccess />;
  if (!client) notFound();

  if (!searchConsoleConfigured()) {
    return (
      <section className="view">
        <EmptyState label="Pendiente">
          Falta la cuenta de servicio de Google (GOOGLE_SERVICE_ACCOUNT_EMAIL y GOOGLE_SERVICE_ACCOUNT_KEY).
        </EmptyState>
      </section>
    );
  }
  const state = client.integrations.search_console;
  if (!state.connected || !state.accountRef) {
    return (
      <section className="view">
        <ConnectState kind="search_console" client={client} />
      </section>
    );
  }
  const siteUrl = state.accountRef;
  const period = readPeriod(query);

  let report: GscReport | null = null;
  let error: string | null = null;
  try {
    report = await getSearchConsoleReport(siteUrl, period);
  } catch (e) {
    console.error("[search-console] report", e);
    error = searchConsoleErrorMessage(e);
  }

  const status = (
    <SyncStatus source={`Search Console · ${siteLabel(siteUrl)}`} live error={error} internal>
      <a className="btn-secondary" href={searchConsoleUrl(siteUrl)} target="_blank" rel="noreferrer">
        <Icon name="arrow-out" size={15} strokeWidth={2} />
        Abrir en Search Console
      </a>
      <RefreshSearchConsole />
    </SyncStatus>
  );

  if (!report) return <section className="view">{status}</section>;

  if (!report.lastDate) {
    return (
      <section className="view">
        {status}
        <EmptyState label="Sin datos">
          Search Console no registra búsquedas de este sitio {periodPhrase(period)}. Guarda los últimos 16 meses y los
          últimos dos o tres días todavía no están cerrados.
        </EmptyState>
      </section>
    );
  }

  const { totals, previousTotals: before } = report;
  const shown = range(report.current.since, report.current.until);
  const cut = report.current.until < period.until;
  const versus = `vs. ${report.previous.label}`;
  const change = (key: keyof GscMetrics, better: Better, format: (v: number) => string) =>
    before ? compare(totals[key], before[key], { better, format, versus: `Antes (${report.previous.label})` }) : null;

  const queries = report.queries;
  const at = (min: number, max: number) => queries.filter((q) => q.position !== null && q.position > min && q.position <= max).length;
  const buckets = [
    { name: "Top 3", value: at(0, 3.5) },
    { name: "4–10", value: at(3.5, 10.5) },
    { name: "11–20", value: at(10.5, 20.5) },
    { name: "21–50", value: at(20.5, 50.5) },
    { name: "+50", value: at(50.5, Infinity) },
  ];
  // Oportunidades: búsquedas donde ya aparece, pero de la cuarta posición para abajo
  // (hasta la segunda página). Subir unos lugares es donde más clics se ganan.
  const chances = queries
    .filter((q) => q.position !== null && q.position > 3.5 && q.position <= 20.5)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 8);
  const topImpressions = chances[0]?.impressions ?? 1;
  const chanceImpressions = queries
    .filter((q) => q.position !== null && q.position > 10.5 && q.position <= 20.5)
    .reduce((a, q) => a + q.impressions, 0);
  // Las búsquedas anónimas no vienen por consulta: lo que falta para el total.
  const listedClicks = queries.reduce((a, q) => a + q.clicks, 0);
  const hiddenShare = totals.clicks ? ((totals.clicks - listedClicks) / totals.clicks) * 100 : 0;

  const sitemaps = report.sitemaps ?? [];

  return (
    <section className="view">
      {status}

      <h2 className="seo-section">
        Rendimiento en Google
        <span>
          {shown}
          {cut ? ` · datos hasta el ${shortDate(report.current.until)}, Google los cierra con 2 o 3 días de demora` : ""}
        </span>
      </h2>
      <div className="grid g4 mb-4">
        <Kpi
          label="Clics"
          icon="arrow-out"
          value={compact(totals.clicks)}
          sub="visitas desde la búsqueda de Google"
          hero
          change={change("clicks", "up", integer)}
          versus={versus}
        />
        <Kpi
          label="Impresiones"
          icon="eye"
          value={compact(totals.impressions)}
          sub="veces que apareció en los resultados"
          change={change("impressions", "up", integer)}
          versus={versus}
        />
        <Kpi
          label="CTR"
          icon="target"
          value={orDash(totals.ctr, (v) => percent(v))}
          sub="clics sobre impresiones"
          change={change("ctr", "up", (v) => percent(v))}
          versus={versus}
        />
        <Kpi
          label="Posición promedio"
          icon="search"
          value={orDash(totals.position, decimal)}
          sub="en los resultados (1 = el primero)"
          change={change("position", "down", decimal)}
          versus={versus}
        />
      </div>

      {report.daily.length > 1 && (
        <div className="grid g2 mb-4">
          <Card title="Clics por día" hint={shown}>
            <LineChart
              id="gsc-clicks"
              labels={report.daily.map((d) => shortDate(d.date))}
              series={[{ label: "Clics", data: report.daily.map((d) => d.clicks), color: "#B50CC5", fillOpacity: 0.18 }]}
            />
          </Card>
          <Card title="Impresiones por día" hint={shown}>
            <LineChart
              id="gsc-impressions"
              labels={report.daily.map((d) => shortDate(d.date))}
              series={[{ label: "Impresiones", data: report.daily.map((d) => d.impressions), color: "#FE6F61", fillOpacity: 0.2 }]}
            />
          </Card>
        </div>
      )}

      <div className="grid g-2-1 items-stretch mb-4">
        <Card title="Oportunidades" hint="aparece, pero fuera del top 3" className="seo-big-card">
          {chances.length ? (
            <div className="seo-big">
              <div className="seo-big-row head" aria-hidden>
                <span className="lbl">Búsqueda</span>
                <span />
                <span className="vol">Impresiones</span>
                <span className="pos">Posición</span>
              </div>
              {chances.map((q) => (
                <div key={q.key} className="seo-big-row" title={`${q.key}: ${integer(q.impressions)} impresiones, ${integer(q.clicks)} clics`}>
                  <span className="lbl">{q.key}</span>
                  <div className="track">
                    <div className="bar" style={{ width: `${Math.max(2, (q.impressions / topImpressions) * 100)}%` }} />
                  </div>
                  <b className="vol">{integer(q.impressions)}</b>
                  <span className={`pos${q.position! <= 10.5 ? " top" : ""}`}>#{decimal(q.position!)}</span>
                </div>
              ))}
              <p className="seo-note seo-big-note">
                Las búsquedas en las que el sitio ya aparece entre la posición 4 y la 20, de más a menos impresiones. Casi
                todos los clics se los llevan los tres primeros resultados: subir unos lugares en estas es lo que más rinde.
                En color, las que ya están en la primera página.
              </p>
            </div>
          ) : (
            <EmptyState label="Sin datos">Ninguna búsqueda entre la posición 4 y la 20 {periodPhrase(period)}.</EmptyState>
          )}
        </Card>
        <Card title="Distribución" hint="búsquedas por posición" className="seo-dist">
          <StageBars stages={buckets} />
          {chanceImpressions > 0 && (
            <p className="seo-note">
              Las búsquedas en la segunda página (11–20) suman <b>{integer(chanceImpressions)}</b> impresiones.
            </p>
          )}
        </Card>
      </div>

      <Card title="Búsquedas" hint={`${integer(queries.length)} con impresiones · cambio de posición ${versus}`} className="mb-4">
        {queries.length ? (
          <>
            <GscTable kind="query" rows={queries.map((q) => toRow(q))} />
            {hiddenShare >= 5 && (
              <p className="seo-note">
                Google no muestra las búsquedas poco frecuentes por privacidad: el {percent(hiddenShare, 0)} de los clics
                viene de búsquedas que no aparecen en la lista.
              </p>
            )}
          </>
        ) : (
          <EmptyState label="Sin datos">Search Console no informa búsquedas en este período.</EmptyState>
        )}
      </Card>

      <Card title="Páginas" hint={`${integer(report.pages.length)} con impresiones`} className="mb-4">
        {report.pages.length ? (
          <GscTable kind="page" rows={report.pages.map((p) => toRow(p, pagePath(p.key), p.key))} />
        ) : (
          <EmptyState label="Sin datos">Search Console no informa páginas en este período.</EmptyState>
        )}
      </Card>

      <div className="grid g2 mb-4">
        <Card title="Dispositivos" hint="clics por dispositivo">
          {report.devices.length ? (
            <Share rows={report.devices} name={(k) => DEVICES[k] ?? k} />
          ) : (
            <EmptyState label="Sin datos">Sin clics en este período.</EmptyState>
          )}
        </Card>
        <Card title="Países" hint="de dónde buscan">
          {report.countries.length ? (
            <Share rows={report.countries.slice(0, 6)} name={countryName} />
          ) : (
            <EmptyState label="Sin datos">Sin clics en este período.</EmptyState>
          )}
        </Card>
      </div>

      <Card title="Sitemaps" hint={report.sitemaps ? `${sitemaps.length} enviados a Google` : undefined}>
        {!report.sitemaps ? (
          <p className="muted seo-none">No se pudieron leer los sitemaps.</p>
        ) : sitemaps.length === 0 ? (
          <EmptyState label="Pendiente">
            El sitio no tiene ningún sitemap enviado en Search Console. Enviarlo ayuda a que Google encuentre todas las
            páginas.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table className="ctable">
              <thead>
                <tr>
                  <th>Sitemap</th>
                  <th>Estado</th>
                  <th>URLs</th>
                  <th>Última lectura de Google</th>
                </tr>
              </thead>
              <tbody>
                {sitemaps.map((s) => (
                  <tr key={s.path}>
                    <td className="seo-page" title={s.path}>
                      <a href={s.path} target="_blank" rel="noreferrer">
                        {pagePath(s.path)}
                      </a>
                      {s.index && <span className="seo-map">Índice</span>}
                    </td>
                    <td>
                      {s.errors > 0 ? (
                        <Pill variant="atencion">
                          {integer(s.errors)} {s.errors === 1 ? "error" : "errores"}
                        </Pill>
                      ) : s.pending ? (
                        <Pill variant="pendiente">Pendiente</Pill>
                      ) : s.warnings > 0 ? (
                        <Pill variant="warm">
                          {integer(s.warnings)} {s.warnings === 1 ? "advertencia" : "advertencias"}
                        </Pill>
                      ) : (
                        <Pill variant="activo">Correcto</Pill>
                      )}
                    </td>
                    <td className="num">{s.submitted !== null ? integer(s.submitted) : <span className="muted">—</span>}</td>
                    <td>{s.lastDownloaded ? localDate(s.lastDownloaded) : <span className="muted">Nunca</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </section>
  );
}
