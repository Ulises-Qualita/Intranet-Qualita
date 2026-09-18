import Link from "next/link";
import { notFound } from "next/navigation";
import { StageBars } from "@/components/charts";
import { Icon } from "@/components/icons";
import { RangePicker, readRange } from "@/components/range-picker";
import { Topbar } from "@/components/topbar";
import { Card, ConnectState, EmptyState, Kpi, KpiLocked, NoAccess, Pill } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { prepareCrmView } from "@/lib/crm-sync";
import { crmPeriod, getClient, getCrmSnapshot, getLeads, leadFunnel } from "@/lib/data";
import { integer, money, percent, relativeTime } from "@/lib/format";
import { AdsTable } from "./ads-table";

// Color del chip de etapa según cómo terminó la oportunidad: ganada, perdida o
// todavía abierta.
const stagePill = (status: string | null) => (status === "won" ? "activo" : status === "lost" ? "pausado" : "neg");

export default async function ClienteCrmPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ dias?: string }>;
}) {
  const [{ id }, { dias }] = await Promise.all([params, searchParams]);
  const days = readRange(dias);
  const session = await getAreaSession("crm");
  if (!session) {
    return (
      <>
        <Topbar crumb="Clientes" title="CRM y ventas" />
        <NoAccess />
      </>
    );
  }

  const c = await getClient(id);
  if (!c) notFound();

  if (!c.conn.crm) {
    return (
      <>
        <Topbar crumb={c.name} title="CRM y ventas" />
        <section className="view">
          <ConnectState kind="crm" client={c} />
        </section>
      </>
    );
  }

  // Asegura datos la primera vez y programa el refresco si quedaron viejos.
  const secrets = await prepareCrmView(c.id);
  const [snapshot, all] = await Promise.all([
    getCrmSnapshot(c.id),
    getLeads(c.id),
  ]);

  // Todo el bloque se recorta por fecha de creación, según el selector del topbar.
  const { leads, won, withSource, fromMeta, tickets, ticketAvg, ticketTotal, sellers, sources, ads } = crmPeriod(all, days);
  const periodo = `últimos ${days} días`;

  return (
    <>
      <Topbar crumb={c.name} title="CRM y ventas">
        <RangePicker basePath={`/clientes/${c.slug}/crm`} days={days} />
        {/* Ya conectado, la pantalla de conexión sigue siendo donde se elige qué
            etapas cuentan como venta ganada. */}
        <Link href={`/clientes/${c.slug}/crm/conectar`} className="btn-secondary">
          <Icon name="settings" size={15} strokeWidth={2} />
          Configurar
        </Link>
      </Topbar>
      <section className="view">
        {secrets?.sync_error && <p className="form-error">{secrets.sync_error}</p>}

        <div className="grid g4 mb-4">
          {snapshot ? (
            <>
              <Kpi label="Oportunidades" icon="target" value={integer(leads.length)} sub={periodo} hero />
              {won === null ? (
                <KpiLocked label="Ganadas" icon="check" note="Falta correr la migración de estados" />
              ) : (
                <Kpi label="Ganadas" icon="check" value={integer(won)} sub={periodo} />
              )}
              {ticketAvg === null ? (
                <KpiLocked label="Ticket promedio" icon="money" note={`Sin tickets cargados en los ${days} días`} />
              ) : (
                <Kpi
                  label="Ticket promedio"
                  icon="money"
                  value={money(ticketAvg)}
                  sub={`${tickets} ${tickets === 1 ? "venta con ticket" : "ventas con ticket"} · ${money(ticketTotal)} en total`}
                />
              )}
              {withSource === 0 ? (
                <KpiLocked label="Desde Meta" icon="reach" note="El CRM no tiene el origen cargado" />
              ) : (
                <Kpi
                  label="Desde Meta"
                  icon="reach"
                  value={integer(fromMeta)}
                  sub={`${percent((fromMeta * 100) / withSource, 0)} de las ${withSource} con origen`}
                />
              )}
            </>
          ) : (
            <>
              <KpiLocked label="Oportunidades" icon="target" note="Sin datos sincronizados" />
              <KpiLocked label="Ganadas" icon="check" note="Sin datos sincronizados" />
              <KpiLocked label="Ticket promedio" icon="money" note="Sin datos sincronizados" />
              <KpiLocked label="Desde Meta" icon="reach" note="Sin datos sincronizados" />
            </>
          )}
        </div>

        {/* items-stretch: acá las dos tarjetas comparten alto (el resto de las
            filas usa el alto de su propio contenido). */}
        <div className="grid g-2-1 items-stretch">
          <Card
            title="Etapas del embudo"
            hint={
              secrets?.synced_at
                ? `${leads.length} oportunidades · ${periodo} · actualizado ${relativeTime(secrets.synced_at)}`
                : `${leads.length} oportunidades · ${periodo}`
            }
          >
            {leads.length ? (
              <StageBars stages={leadFunnel(leads, secrets?.stage_order)} />
            ) : (
              <EmptyState label="Sin datos">Ninguna oportunidad creada en los últimos {days} días.</EmptyState>
            )}
          </Card>
          <Card title="Origen" hint={periodo} className="source-card">
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
        </div>

        {/* items-stretch: la lista de oportunidades acompaña el alto de las dos
            tarjetas apiladas de la izquierda. */}
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
                <AdsTable ads={ads} clientSlug={c.slug} days={days} />
              )}
            </Card>
          </div>
          <Card title="Últimas oportunidades">
            {leads.length === 0 ? (
              <EmptyState label="Sin datos">Ninguna oportunidad creada en los últimos {days} días.</EmptyState>
            ) : (
              leads.slice(0, 8).map((l) => (
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
              ))
            )}
          </Card>
        </div>
      </section>
    </>
  );
}
