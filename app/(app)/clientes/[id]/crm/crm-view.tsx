import { StageBars } from "@/components/charts";
import { RangePicker } from "@/components/range-picker";
import { SyncStatus } from "@/components/sync-status";
import { Topbar } from "@/components/topbar";
import { Card, EmptyState, Kpi, KpiLocked, MissingIntegration, Pill } from "@/components/ui";
import { countReached, getChatEvents, getStageEvents, getStageReached } from "@/lib/crm-chats";
import { crmProviderLabel, noSourceLabel } from "@/lib/crm-shared";
import { prepareCrmView, salesOutsideCrm } from "@/lib/crm-sync";
import {
  type Client,
  crmPeriod,
  getCrmSnapshot,
  getLeads,
  getGadsDaily,
  getMetaCampaigns,
  getMetaDaily,
  getSales,
  leadFunnel,
  salesPeriod,
  sourcesWithAdLeads,
  topMetaVideos,
  withMetaAdNames,
} from "@/lib/data";
import { compare } from "@/lib/compare";
import { dollars, integer, localDate, money, percent, relativeTime, todayISO } from "@/lib/format";
import { CRM_HISTORY_DAYS, type Period, periodPhrase, periodQuery, previousPeriod, shiftDate, versusLabel } from "@/lib/period";
import { AdsTable } from "./ads-table";
import { ChatMonitor } from "./chat-monitor";
import { SourceList } from "./source-list";
import { TopVideos, topVideosHint } from "./top-videos";

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
        {!internal && <Topbar crumb={c.name} title="CRM y ventas" />}
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
  // Atención por chat: solo el equipo y solo Kommo, que es el que registra los mensajes.
  const kommoUrl = internal && secrets?.provider === "kommo" ? secrets.kommo?.url : undefined;
  // Ventas fuera del CRM: en lugar de "Ganadas", los que llegaron a una etapa.
  const milestone = salesOutsideCrm(secrets) ? (secrets?.milestone_stage ?? null) : null;
  const [snapshot, all, campaigns, chatEvents, allSales, stageEvents, metaDaily, gadsDaily, reached] = await Promise.all([
    getCrmSnapshot(c.id),
    getLeads(c.id),
    showVideos ? getMetaCampaigns(c.id, range) : null,
    kommoUrl ? getChatEvents(c.id, range) : undefined,
    secrets?.sales_sheet ? getSales(c.id) : null,
    // Historial de etapas: en qué etapa estaba cada lead cuando le respondieron.
    kommoUrl ? getStageEvents(c.id) : null,
    // Leads de Meta y conversiones de Google Ads del período, los mismos números
    // de las solapas META y GADS (las dos con el área META): van en la card de
    // oportunidades por origen. Si no se pueden leer, queda lo del CRM.
    c.conn.meta && seesMeta ? getMetaDaily(c.id, range).catch(() => null) : null,
    c.conn.google_ads && seesMeta ? getGadsDaily(c.id, range).catch(() => null) : null,
    milestone ? getStageReached(c.id, milestone).catch(() => null) : null,
  ]);

  // Leads sin origen: en Kommo son los que escribieron directo por WhatsApp.
  const noSource = noSourceLabel(secrets?.provider);
  // Ventas que el cliente registra fuera del CRM (sales_off): se muestran como
  // pendientes, no como 0.
  const salesOff = salesOutsideCrm(secrets);
  const salesOffNote = "Las ventas no se registran en el CRM";
  // Las oportunidades se recortan por fecha de creación y las ventas (ganadas,
  // tickets) por fecha de venta, según el selector del topbar.
  const { leads, won, tickets, ticketAvg, ticketTotal, sellers, sources, wonSources, ads: crmAds } = crmPeriod(all, range, noSource);
  // El CRM puede guardar el anuncio con un nombre corto: se pasa al nombre de Meta
  // para que la tabla y los videos crucen con lo que muestra la solapa META.
  const ads = campaigns ? withMetaAdNames(crmAds, campaigns.flatMap((cp) => cp.ads)) : crmAds;
  const periodo = range.label;
  // Oportunidades por origen: Meta y Google Ads con lo que reporta cada plataforma.
  const sourceRows = sourcesWithAdLeads(
    sources,
    {
      meta: metaDaily ? metaDaily.reduce((t, d) => t + d.leads, 0) : null,
      gads: gadsDaily ? gadsDaily.reduce((t, d) => t + d.conversions, 0) : null,
    },
    noSource,
  );
  const platformName = { meta: "Meta Ads", gads: "Google Ads" } as const;

  // Comparación contra el período anterior. Las ventas se cuentan por fecha de
  // venta (no de creación del lead), así que ganadas y total en tickets también
  // son parejas de comparar.
  const previous = previousPeriod(range);
  // Solo si el período anterior está entero dentro de lo que hay: ni más atrás de
  // lo que trae el CRM, ni antes de la primera oportunidad cargada (un CRM recién
  // estrenado daría una suba que es solo el arranque).
  const firstDay = all.length ? localDate(all.reduce((min, l) => (l.created_at < min ? l.created_at : min), all[0].created_at)) : null;
  // Tampoco antes del día desde el que el registro del CRM es completo.
  const comparable =
    !!firstDay &&
    firstDay <= previous.since &&
    previous.since >= shiftDate(todayISO(), CRM_HISTORY_DAYS) &&
    (!secrets?.since || previous.since >= secrets.since);
  const before = comparable ? crmPeriod(all, previous, noSource) : null;
  const versus = versusLabel(range);
  const antes = `Antes (${previous.label})`;
  const leadsChange = before && compare(leads.length, before.leads.length, { better: "up", format: integer, versus: antes });
  const ticketChange = before && compare(ticketAvg, before.ticketAvg, { better: "up", format: (v) => money(v), versus: antes });
  const wonChange = before && compare(won, before.won, { better: "up", format: integer, versus: antes });
  // Llegaron a la etapa: de las oportunidades creadas en el período. Se compara
  // solo si el historial de etapas cubre el período anterior entero.
  const reachedNow = milestone && reached ? countReached(leads, milestone, reached.ids) : null;
  const reachedChange =
    milestone && reached && before && reached.since && reached.since <= previous.since
      ? compare(reachedNow, countReached(before.leads, milestone, reached.ids), { better: "up", format: integer, versus: antes })
      : null;
  const ticketTotalChange = before && compare(ticketTotal, before.ticketTotal, { better: "up", format: (v) => money(v), versus: antes });
  // Mismo criterio que la solapa META: primero ventas, después CPL. Las ventas
  // entran si el CRM sabe qué leads se ganaron (won no es null).
  const showWon = won !== null && !salesOff;
  const top = campaigns && topMetaVideos(campaigns, showWon ? ads : null);

  // Con planilla de ventas, las ventas y la facturación salen de ahí y se cuentan
  // por fecha de confirmación: eso sí se puede comparar con el período anterior,
  // siempre que la planilla lo cubra entero.
  const sheet = allSales && salesPeriod(allSales, all, range, noSource);
  const firstSale = allSales?.length ? allSales[allSales.length - 1].confirmed_on : null;
  const sheetBefore = allSales && firstSale && firstSale <= previous.since ? salesPeriod(allSales, all, previous, noSource) : null;
  const saleChange = (now: number | null, then: number | null | undefined, format: (v: number) => string) =>
    sheetBefore ? compare(now, then ?? null, { better: "up", format, versus: antes }) : null;
  return (
    <>
      {/* El equipo tiene el encabezado, las solapas y el período en clientes/[id]/layout.tsx. */}
      {!internal && (
        <Topbar crumb={c.name} title="CRM y ventas">
          <RangePicker basePath={`${base}/crm`} period={range} />
        </Topbar>
      )}
      {/* "Configurar" (etapas que cuentan como venta ganada) está en la barra de
          solapas del equipo: configHref en clientes/[id]/layout.tsx. */}
      <section className="view">
        <SyncStatus
          source={secrets ? crmProviderLabel(secrets.provider) : "CRM"}
          at={secrets?.synced_at}
          error={secrets?.sync_error}
          internal={internal}
        />
        {internal && secrets?.sales_sheet && (secrets.sales_error || !allSales) && (
          <p className="form-error crm-base-note">
            Planilla de ventas: {secrets.sales_error ?? "falta correr docs/sql/2026-10-06-ventas-planilla.sql en Supabase."}
            {secrets.sales_error && allSales?.length ? " Se muestran las ventas de la última lectura." : ""}
          </p>
        )}

        {sheet ? (
          <div className="grid g3 mb-4">
            <Kpi label="Oportunidades" icon="target" value={integer(leads.length)} sub={periodo} hero change={leadsChange} versus={versus} />
            <Kpi
              label="Facturación en pesos"
              icon="money"
              value={money(sheet.ars.total)}
              sub={`${integer(sheet.ars.count)} ${sheet.ars.count === 1 ? "venta" : "ventas"} con monto en pesos`}
              change={saleChange(sheet.ars.total, sheetBefore?.ars.total, money)}
              versus={versus}
            />
            {sheet.ars.avg === null ? (
              <KpiLocked label="Ticket promedio en pesos" icon="money" note={`Sin ventas en pesos ${periodPhrase(range)}`} />
            ) : (
              <Kpi
                label="Ticket promedio en pesos"
                icon="money"
                value={money(sheet.ars.avg)}
                sub={periodo}
                change={saleChange(sheet.ars.avg, sheetBefore?.ars.avg, money)}
                versus={versus}
              />
            )}
            <Kpi
              label="Ventas confirmadas"
              icon="check"
              value={integer(sheet.sales.length)}
              sub={`según la planilla · ${periodo}`}
              change={saleChange(sheet.sales.length, sheetBefore?.sales.length, integer)}
              versus={versus}
            />
            <Kpi
              label="Facturación en dólares"
              icon="money"
              value={dollars(sheet.usd.total)}
              sub={`${integer(sheet.usd.count)} ${sheet.usd.count === 1 ? "venta" : "ventas"} con monto en dólares`}
              change={saleChange(sheet.usd.total, sheetBefore?.usd.total, dollars)}
              versus={versus}
            />
            {sheet.usd.avg === null ? (
              <KpiLocked label="Ticket promedio en dólares" icon="money" note={`Sin ventas en dólares ${periodPhrase(range)}`} />
            ) : (
              <Kpi
                label="Ticket promedio en dólares"
                icon="money"
                value={dollars(sheet.usd.avg)}
                sub={periodo}
                change={saleChange(sheet.usd.avg, sheetBefore?.usd.avg, dollars)}
                versus={versus}
              />
            )}
          </div>
        ) : (
          <div className="grid g4 mb-4">
            {snapshot ? (
              <>
                <Kpi label="Oportunidades" icon="target" value={integer(leads.length)} sub={periodo} hero change={leadsChange} versus={versus} />
                {salesOff ? (
                  <>
                    {milestone && reachedNow !== null ? (
                      <Kpi
                        label={`Llegaron a "${milestone}"`}
                        icon="check"
                        value={integer(reachedNow)}
                        sub={`de ${integer(leads.length)} oportunidades · ${periodo}`}
                        change={reachedChange}
                        versus={versus}
                      />
                    ) : (
                      <KpiLocked label="Ganadas" icon="check" note={salesOffNote} />
                    )}
                    <KpiLocked label="Total en tickets" icon="money" note={salesOffNote} />
                    <KpiLocked label="Ticket promedio" icon="money" note={salesOffNote} />
                  </>
                ) : won === null ? (
                  <KpiLocked label="Ganadas" icon="check" note={internal ? "Falta correr la migración de estados" : "Sin datos"} />
                ) : (
                  <Kpi
                    label="Ganadas"
                    icon="check"
                    value={integer(won)}
                    sub={`por fecha de venta · ${periodo}`}
                    change={wonChange}
                    versus={versus}
                  />
                )}
                {salesOff ? null : ticketAvg === null ? (
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
                      change={ticketTotalChange}
                      versus={versus}
                    />
                    <Kpi label="Ticket promedio" icon="money" value={money(ticketAvg)} sub={periodo} change={ticketChange} versus={versus} />
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
        )}

        {/* La columna izquierda (embudo, vendedores, anuncios) manda el alto de
            la fila. La derecha no lo agranda (crm-side): las tarjetas de origen
            van con su alto y "Últimas oportunidades" ocupa lo que sobra, con
            scroll adentro. */}
        <div className="grid g-2-1 items-stretch">
          <div className="stack-cards">
            <Card
              title="Etapas del embudo"
              className="funnel-card"
              hint={`${leads.length} oportunidades · ${periodo}`}
            >
              {leads.length ? (
                <StageBars stages={leadFunnel(leads, secrets?.stage_order)} />
              ) : (
                <EmptyState label="Sin datos">Ninguna oportunidad creada {periodPhrase(range)}.</EmptyState>
              )}
            </Card>
            <Card title="Por vendedor" hint={sheet ? `ventas de la planilla · ${periodo}` : periodo}>
              {sheet ? (
                sheet.sellers.length === 0 ? (
                  <EmptyState label="Sin datos">Ninguna venta confirmada en el período.</EmptyState>
                ) : (
                  <div className="table-wrap">
                    <table className="ctable">
                      <thead>
                        <tr>
                          <th>Vendedor</th>
                          <th>Ventas</th>
                          <th>Ticket en pesos</th>
                          <th>Ticket en dólares</th>
                          <th>Facturado en pesos</th>
                          <th>Facturado en dólares</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sheet.sellers.map((s) => (
                          <tr key={s.name}>
                            <td>
                              <b>{s.name}</b>
                            </td>
                            <td className="num">{integer(s.sales)}</td>
                            <td className="num">{s.ars.avg === null ? "—" : money(s.ars.avg)}</td>
                            <td className="num">{s.usd.avg === null ? "—" : dollars(s.usd.avg)}</td>
                            <td className="num">{s.ars.total ? money(s.ars.total) : "—"}</td>
                            <td className="num">{s.usd.total ? dollars(s.usd.total) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              ) : sellers.length === 0 ? (
                <EmptyState label="Sin datos">Sin oportunidades en el período.</EmptyState>
              ) : (
                <div className="table-wrap">
                  <table className="ctable">
                    <thead>
                      <tr>
                        <th>Vendedor</th>
                        <th>Oportunidades</th>
                        {!salesOff && (
                          <>
                            <th>Ganadas</th>
                            <th>Ticket promedio</th>
                            <th>Facturado</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {sellers.map((s) => (
                        <tr key={s.name}>
                          <td>
                            <b>{s.name}</b>
                          </td>
                          <td className="num">{integer(s.leads)}</td>
                          {!salesOff && (
                            <>
                              <td className="num">{integer(s.won)}</td>
                              <td className="num">{s.ticketAvg === null ? "—" : money(s.ticketAvg)}</td>
                              <td className="num">{s.ticketTotal ? money(s.ticketTotal) : "—"}</td>
                            </>
                          )}
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
                <AdsTable ads={ads} base={base} query={periodQuery(range)} showWon={!salesOff} />
              )}
            </Card>
          </div>
          <div className="stack-cards crm-side">
            <Card title="Oportunidades por origen" hint={periodo} className="source-card">
              {sourceRows.length === 0 ? (
                <EmptyState label="Sin datos">Sin oportunidades en el período.</EmptyState>
              ) : (
                <SourceList
                  title="Oportunidades por origen"
                  hint={periodo}
                  rows={sourceRows.map((s) => ({
                    name: s.name,
                    detail: [
                      `${percent(s.share, 0)} del total`,
                      s.platform ? `según ${platformName[s.platform]}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · "),
                    value: integer(s.leads),
                  }))}
                />
              )}
            </Card>
            <Card title="Ventas por origen" hint={sheet ? `por fecha de confirmación · ${periodo}` : periodo} className="source-card">
              {sheet ? (
                sheet.sources.length === 0 ? (
                  <EmptyState label="Sin datos">Ninguna venta confirmada en el período.</EmptyState>
                ) : (
                  <SourceList
                    title="Ventas por origen"
                    hint={`por fecha de confirmación · ${periodo}`}
                    rows={sheet.sources.map((s) => ({
                      name: s.name,
                      detail: [`${percent(s.share, 0)} de las ventas`, s.ars ? money(s.ars) : null, s.usd ? dollars(s.usd) : null]
                        .filter(Boolean)
                        .join(" · "),
                      value: integer(s.sales),
                    }))}
                  />
                )
              ) : salesOff ? (
                <EmptyState label="Pendiente">{salesOffNote}: se van a conectar desde otra fuente.</EmptyState>
              ) : wonSources === null ? (
                <EmptyState label="Pendiente">{internal ? "Falta correr la migración de estados." : "Todavía no hay datos de ventas."}</EmptyState>
              ) : wonSources.length === 0 ? (
                <EmptyState label="Sin datos">Ninguna venta ganada en el período.</EmptyState>
              ) : (
                <SourceList
                  title="Ventas por origen"
                  hint={periodo}
                  rows={wonSources.map((s) => ({
                    name: s.name,
                    detail: [`${percent(s.share, 0)} de las ventas`, s.ticketTotal ? `${money(s.ticketTotal)} facturado` : null]
                      .filter(Boolean)
                      .join(" · "),
                    value: integer(s.leads),
                  }))}
                />
              )}
            </Card>
            <Card title="Últimas oportunidades" className="feed-card">
              {leads.length === 0 ? (
                <EmptyState label="Sin datos">Ninguna oportunidad creada {periodPhrase(range)}.</EmptyState>
              ) : (
                <div className="feed-list">
                  {leads.slice(0, 20).map((l) => (
                    <div key={l.id} className="lead-row">
                      <div className="info">
                        <b>{l.name}</b>
                        <span>{[l.source, relativeTime(l.created_at)].filter(Boolean).join(" · ")}</span>
                      </div>
                      {(l.amount !== null || l.amount_usd !== null) && (
                        <span className="amount">
                          {[l.amount !== null ? money(l.amount) : null, l.amount_usd !== null ? dollars(l.amount_usd) : null]
                            .filter(Boolean)
                            .join(" + ")}
                        </span>
                      )}
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
        </div>

        {kommoUrl && chatEvents !== undefined && (
          <ChatMonitor
            events={chatEvents}
            leads={all}
            stages={stageEvents}
            stageOrder={secrets?.stage_order}
            stageError={secrets?.stage_error ?? null}
            range={range}
            error={secrets?.chat_error ?? null}
          />
        )}

        {top && (
          <Card
            title="Videos con mejor rendimiento"
            hint={`${topVideosHint(top, showWon)} · ${periodo}`}
            className="mt-4"
          >
            {top.videos.length ? (
              <TopVideos
                videos={top.videos}
                showWon={showWon}
                clientSlug={c.slug}
                base={base}
                query={periodQuery(range)}
                hideMedia={!!secrets?.demo}
              />
            ) : (
              <EmptyState label="Sin datos">
                {top.total
                  ? `Ningún video generó ventas ni leads ${periodPhrase(range)}.`
                  : `No hay anuncios de video con entrega ${periodPhrase(range)} (o todavía no se sincronizaron sus creativos).`}
              </EmptyState>
            )}
          </Card>
        )}
      </section>
    </>
  );
}
