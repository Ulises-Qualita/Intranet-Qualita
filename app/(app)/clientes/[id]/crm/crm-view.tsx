import Link from "next/link";
import { StageBars } from "@/components/charts";
import { Icon } from "@/components/icons";
import { RangePicker } from "@/components/range-picker";
import { Topbar } from "@/components/topbar";
import { Card, EmptyState, Kpi, KpiLocked, MissingIntegration, Pill } from "@/components/ui";
import { prepareCrmView } from "@/lib/crm-sync";
import { type Client, crmPeriod, getCrmSnapshot, getLeads, getMetaCampaigns, leadFunnel, topVideoAds } from "@/lib/data";
import { integer, money, percent, relativeTime } from "@/lib/format";
import { type Period, periodPhrase, periodQuery } from "@/lib/period";
import { AdsTable } from "./ads-table";
import { TopVideos } from "./top-videos";

// Color del chip de etapa según cómo terminó la oportunidad: ganada, perdida o
// todavía abierta.
const stagePill = (status: string | null) => (status === "won" ? "activo" : status === "lost" ? "pausado" : "neg");

// CRM de un cliente. La usan el equipo (/clientes/[slug]/crm) y la cuenta del
// propio cliente (/mi-empresa/crm): quien la llama ya validó el acceso.
// `internal` muestra lo que es solo del equipo (Configurar, errores de sync);
// `seesMeta` decide si entra la card de videos, que sale de los datos de Meta.
export async function CrmView({
  c,
  range,
  base,
  internal,
  seesMeta,
}: {
  c: Client;
  range: Period;
  base: string;
  internal: boolean;
  seesMeta: boolean;
}) {
  if (!c.conn.crm) {
    return (
      <>
        <Topbar crumb={c.name} title="CRM y ventas" />
        <section className="view">
          <MissingIntegration kind="crm" client={c} internal={internal} />
        </section>
      </>
    );
  }

  // Asegura datos la primera vez y programa el refresco si quedaron viejos.
  const secrets = await prepareCrmView(c.id);
  // Los videos salen de Meta (qué anuncio es video, gasto, miniatura): la card
  // solo aparece si el cliente tiene Meta y el usuario puede verlo.
  const showVideos = c.conn.meta && seesMeta;
  const [snapshot, all, campaigns] = await Promise.all([
    getCrmSnapshot(c.id),
    getLeads(c.id),
    showVideos ? getMetaCampaigns(c.id, range) : null,
  ]);

  // Todo el bloque se recorta por fecha de creación, según el selector del topbar.
  const { leads, won, tickets, ticketAvg, ticketTotal, sellers, sources, wonSources, ads } = crmPeriod(all, range);
  const periodo = range.label;
  const top = campaigns && topVideoAds(campaigns, ads);

  return (
    <>
      <Topbar crumb={c.name} title="CRM y ventas">
        <RangePicker basePath={`${base}/crm`} period={range} />
        {/* Ya conectado, la pantalla de conexión sigue siendo donde se elige qué
            etapas cuentan como venta ganada. Solo para el equipo. */}
        {internal && (
          <Link href={`${base}/crm/conectar`} className="btn-secondary">
            <Icon name="settings" size={15} strokeWidth={2} />
            Configurar
          </Link>
        )}
      </Topbar>
      <section className="view">
        {internal && secrets?.sync_error && <p className="form-error">{secrets.sync_error}</p>}

        <div className="grid g4 mb-4">
          {snapshot ? (
            <>
              <Kpi label="Oportunidades" icon="target" value={integer(leads.length)} sub={periodo} hero />
              {won === null ? (
                <KpiLocked label="Ganadas" icon="check" note={internal ? "Falta correr la migración de estados" : "Sin datos"} />
              ) : (
                <Kpi label="Ganadas" icon="check" value={integer(won)} sub={periodo} />
              )}
              {ticketAvg === null ? (
                <>
                  <KpiLocked label="Total en tickets" icon="money" note={`Sin tickets cargados ${periodPhrase(range)}`} />
                  <KpiLocked label="Ticket promedio" icon="money" note={`Sin tickets cargados ${periodPhrase(range)}`} />
                </>
              ) : (
                <>
                  <Kpi
                    label="Total en tickets"
                    icon="money"
                    value={money(ticketTotal)}
                    sub={`${tickets} ${tickets === 1 ? "venta con ticket" : "ventas con ticket"}`}
                  />
                  <Kpi label="Ticket promedio" icon="money" value={money(ticketAvg)} sub={periodo} />
                </>
              )}
            </>
          ) : (
            <>
              <KpiLocked label="Oportunidades" icon="target" note="Sin datos sincronizados" />
              <KpiLocked label="Ganadas" icon="check" note="Sin datos sincronizados" />
              <KpiLocked label="Total en tickets" icon="money" note="Sin datos sincronizados" />
              <KpiLocked label="Ticket promedio" icon="money" note="Sin datos sincronizados" />
            </>
          )}
        </div>

        {/* items-stretch: acá las dos tarjetas comparten alto (el resto de las
            filas usa el alto de su propio contenido). */}
        <div className="grid g-2-1 items-stretch">
          <Card
            title="Etapas del embudo"
            className="funnel-card"
            hint={
              secrets?.synced_at
                ? `${leads.length} oportunidades · ${periodo} · actualizado ${relativeTime(secrets.synced_at)}`
                : `${leads.length} oportunidades · ${periodo}`
            }
          >
            {leads.length ? (
              <StageBars stages={leadFunnel(leads, secrets?.stage_order)} />
            ) : (
              <EmptyState label="Sin datos">Ninguna oportunidad creada {periodPhrase(range)}.</EmptyState>
            )}
          </Card>
          <div className="stack-cards">
            <Card title="Oportunidades por origen" hint={periodo} className="source-card">
              {sources.length === 0 ? (
                <EmptyState label="Sin datos">Sin oportunidades en el período.</EmptyState>
              ) : (
                <div className="source-list">
                  {sources.map((s) => (
                    <div key={s.name} className="lead-row">
                      <div className="info">
                        <b>{s.name}</b>
                        <span>{percent(s.share, 0)} del total</span>
                      </div>
                      <span className="amount">{integer(s.leads)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            <Card title="Ventas por origen" hint={periodo} className="source-card">
              {wonSources === null ? (
                <EmptyState label="Pendiente">{internal ? "Falta correr la migración de estados." : "Todavía no hay datos de ventas."}</EmptyState>
              ) : wonSources.length === 0 ? (
                <EmptyState label="Sin datos">Ninguna venta ganada en el período.</EmptyState>
              ) : (
                <div className="source-list">
                  {wonSources.map((s) => (
                    <div key={s.name} className="lead-row">
                      <div className="info">
                        <b>{s.name}</b>
                        <span>
                          {[`${percent(s.share, 0)} de las ventas`, s.ticketTotal ? `${money(s.ticketTotal)} facturado` : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </div>
                      <span className="amount">{integer(s.leads)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>

        {/* La lista de oportunidades toma el alto de las dos tarjetas apiladas de
            la izquierda y hace scroll adentro (feed-card), en vez de estirar la
            fila y dejar un hueco debajo de "Por anuncio". */}
        <div className="grid g-2-1 items-stretch mt-4">
          <div className="stack-cards">
            <Card title="Por vendedor" hint={periodo}>
              {sellers.length === 0 ? (
                <EmptyState label="Sin datos">Sin oportunidades en el período.</EmptyState>
              ) : (
                <div className="table-wrap">
                  <table className="ctable">
                    <thead>
                      <tr>
                        <th>Vendedor</th>
                        <th>Oportunidades</th>
                        <th>Ganadas</th>
                        <th>Ticket promedio</th>
                        <th>Facturado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sellers.map((s) => (
                        <tr key={s.name}>
                          <td>
                            <b>{s.name}</b>
                          </td>
                          <td className="num">{integer(s.leads)}</td>
                          <td className="num">{integer(s.won)}</td>
                          <td className="num">{s.ticketAvg === null ? "—" : money(s.ticketAvg)}</td>
                          <td className="num">{s.ticketTotal ? money(s.ticketTotal) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
            <Card
              title="Por anuncio"
              hint={ads.length ? `${ads.length} ${ads.length === 1 ? "anuncio" : "anuncios"} · ${periodo}` : periodo}
              className="ads-card"
            >
              {ads.length === 0 ? (
                <EmptyState label="Sin datos">Ninguna oportunidad del período tiene el anuncio cargado en el CRM.</EmptyState>
              ) : (
                <AdsTable ads={ads} base={base} query={periodQuery(range)} />
              )}
            </Card>
          </div>
          <Card title="Últimas oportunidades" className="feed-card">
            {leads.length === 0 ? (
              <EmptyState label="Sin datos">Ninguna oportunidad creada {periodPhrase(range)}.</EmptyState>
            ) : (
              <div className="feed-list">
                {leads.slice(0, 8).map((l) => (
                  <div key={l.id} className="lead-row">
                    <div className="info">
                      <b>{l.name}</b>
                      <span>{[l.source, relativeTime(l.created_at)].filter(Boolean).join(" · ")}</span>
                    </div>
                    {l.amount !== null && <span className="amount">{money(l.amount)}</span>}
                    {/* La etapa del CRM y no una temperatura calculada: en Odoo la
                        probabilidad la fija la etapa, así que "en negociación" salía
                        hasta en oportunidades que no contestan. */}
                    {l.stage && <Pill variant={stagePill(l.status)}>{l.stage}</Pill>}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {top && (
          <Card
            title="Videos con mejor rendimiento"
            hint={
              top.by === "crm"
                ? `según ventas y oportunidades del CRM · ${periodo}`
                : `según leads de Meta (el CRM no tiene videos atribuidos) · ${periodo}`
            }
            className="mt-4"
          >
            {top.videos.length ? (
              <TopVideos videos={top.videos} by={top.by} showWon={won !== null} clientSlug={c.slug} base={base} query={periodQuery(range)} />
            ) : (
              <EmptyState label="Sin datos">
                {top.total
                  ? `Ningún video generó oportunidades ni leads ${periodPhrase(range)}.`
                  : `No hay anuncios de video con entrega ${periodPhrase(range)} (o todavía no se sincronizaron sus creativos).`}
              </EmptyState>
            )}
          </Card>
        )}
      </section>
    </>
  );
}
