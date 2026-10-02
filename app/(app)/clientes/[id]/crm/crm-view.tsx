import { StageBars } from "@/components/charts";
import { RangePicker } from "@/components/range-picker";
import { SyncStatus } from "@/components/sync-status";
import { Topbar } from "@/components/topbar";
import { Card, EmptyState, Kpi, KpiLocked, MissingIntegration, Pill } from "@/components/ui";
import { getChatEvents, getChatStart } from "@/lib/crm-chats";
import { type CrmExclusion, crmProviderLabel } from "@/lib/crm-shared";
import { prepareCrmView } from "@/lib/crm-sync";
import {
  type Client,
  crmPeriod,
  getCrmSnapshot,
  getExcludedLeads,
  getLeads,
  getMetaCampaigns,
  leadFunnel,
  topVideoAds,
} from "@/lib/data";
import { compare } from "@/lib/compare";
import { integer, localDate, money, percent, relativeTime, shortDate, todayISO } from "@/lib/format";
import { CRM_HISTORY_DAYS, type Period, periodPhrase, periodQuery, previousPeriod, shiftDate, versusLabel } from "@/lib/period";
import { AdsTable } from "./ads-table";
import { ChatMonitor } from "./chat-monitor";
import { TopVideos } from "./top-videos";

// Color del chip de etapa según cómo terminó la oportunidad: ganada, perdida o
// todavía abierta.
const stagePill = (status: string | null) => (status === "won" ? "activo" : status === "lost" ? "pausado" : "neg");

// Cómo se nombra cada motivo en el aviso, en singular y en plural.
const EXCLUSION_LABELS: Record<CrmExclusion, [string, string]> = {
  returning: ["de un contacto que ya estaba en el CRM", "de contactos que ya estaban en el CRM"],
  duplicate: ["repetido (mismo teléfono que otro lead)", "repetidos (mismo teléfono que otro lead)"],
  stage: ["en una etapa que no se cuenta", "en etapas que no se cuentan"],
  before_start: ["anterior al registro completo", "anteriores al registro completo"],
};

// "No se cuentan 133 leads del período: 108 de contactos que ya estaban…". null si
// en el período no quedó nada afuera.
function excludedNote(excluded: { created_at: string; excluded: CrmExclusion }[], range: Period, since: string | undefined) {
  const counts = new Map<CrmExclusion, number>();
  for (const lead of excluded) {
    const day = localDate(lead.created_at);
    if (day >= range.since && day <= range.until) counts.set(lead.excluded, (counts.get(lead.excluded) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
  if (!total) return null;

  const parts = Object.entries(EXCLUSION_LABELS).flatMap(([reason, [one, many]]) => {
    const n = counts.get(reason as CrmExclusion);
    return n ? [`${integer(n)} ${n === 1 ? one : many}`] : [];
  });
  const start = since && range.since < since ? ` El registro del CRM es completo desde el ${shortDate(since)}.` : "";
  return `No ${total === 1 ? "se cuenta 1 lead" : `se cuentan ${integer(total)} leads`} del período: ${parts.join(", ")}.${start}`;
}

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
  const [snapshot, all, excluded, campaigns, chatEvents, chatStart] = await Promise.all([
    getCrmSnapshot(c.id),
    getLeads(c.id),
    internal ? getExcludedLeads(c.id) : [],
    showVideos ? getMetaCampaigns(c.id, range) : null,
    kommoUrl ? getChatEvents(c.id, range) : undefined,
    kommoUrl ? getChatStart(c.id) : null,
  ]);

  // Lo que el CRM tiene cargado en el período pero no es una oportunidad nueva
  // (solo lo ve el equipo): cuántos quedaron afuera y por qué.
  const left = excludedNote(excluded, range, secrets?.since);

  // Todo el bloque se recorta por fecha de creación, según el selector del topbar.
  const { leads, won, tickets, ticketAvg, ticketTotal, sellers, sources, wonSources, ads } = crmPeriod(all, range);
  const periodo = range.label;

  // Comparación contra el período anterior, solo en lo que es parejo de comparar:
  // cuántas oportunidades entraron y de cuánto fue el ticket. Ganadas y total en
  // tickets NO se comparan: todo se cuenta por fecha de creación, y las
  // oportunidades del período anterior tuvieron más tiempo para cerrarse, así que
  // el período actual siempre saldría perdiendo.
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
  const before = comparable ? crmPeriod(all, previous) : null;
  const versus = versusLabel(range);
  const antes = `Antes (${previous.label})`;
  const leadsChange = before && compare(leads.length, before.leads.length, { better: "up", format: integer, versus: antes });
  const ticketChange = before && compare(ticketAvg, before.ticketAvg, { better: "up", format: (v) => money(v), versus: antes });
  const top = campaigns && topVideoAds(campaigns, ads);

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
        {left && <p className="hint-text crm-base-note">{left}</p>}

        <div className="grid g4 mb-4">
          {snapshot ? (
            <>
              <Kpi label="Oportunidades" icon="target" value={integer(leads.length)} sub={periodo} hero change={leadsChange} versus={versus} />
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

        {/* items-stretch: acá las dos tarjetas comparten alto (el resto de las
            filas usa el alto de su propio contenido). */}
        <div className="grid g-2-1 items-stretch">
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

        {kommoUrl && chatEvents !== undefined && (
          <ChatMonitor
            events={chatEvents}
            leads={all}
            storedSince={chatStart}
            range={range}
            error={secrets?.chat_error ?? null}
            leadUrl={(leadId) => `${kommoUrl}/leads/detail/${leadId}`}
          />
        )}

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
