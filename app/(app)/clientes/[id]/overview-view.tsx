import { LineChart, StageBars } from "@/components/charts";
import { Icon } from "@/components/icons";
import { RangePicker } from "@/components/range-picker";
import { Topbar } from "@/components/topbar";
import { Card, EmptyState, Kpi, KpiLocked, MissingIntegration } from "@/components/ui";
import { type Client, conversionByChannel, crmPeriod, getLeads, getMetaDaily, leadFunnel } from "@/lib/data";
import { integer, money, orDash, percent, safeDiv, shortDate } from "@/lib/format";
import { type Period, periodPhrase } from "@/lib/period";

// Canales que entran en la card de conversión por canal.
const TOP_CHANNELS = 3;

// Vista general de un cliente. La usan el equipo (/clientes/[slug]) y la cuenta
// del propio cliente (/mi-empresa): quien la llama ya validó el acceso.
// `internal` muestra lo que es solo del equipo (links para conectar
// integraciones); `base` es la ruta de las pestañas de este cliente.
export async function OverviewView({
  c,
  range,
  base,
  internal,
}: {
  c: Client;
  range: Period;
  base: string;
  internal: boolean;
}) {
  const [daily, leads] = await Promise.all([
    c.conn.meta ? getMetaDaily(c.id, range) : [],
    c.conn.crm ? getLeads(c.id) : [],
  ]);

  const last = daily.at(-1);
  const period = daily.length ? `${shortDate(daily[0].date)} – ${shortDate(last!.date)}` : "";
  const spend = daily.reduce((total, d) => total + d.spend, 0);

  // Conversión = ventas ganadas sobre oportunidades creadas en el período. Sin la
  // columna de estado en el CRM (won === null) no hay forma de saber cuáles se
  // ganaron, y la card lo dice en vez de mostrar 0%.
  const crm = crmPeriod(leads, range);
  const won = crm.won;
  const opportunities = crm.leads.length;
  const channels = won === null ? [] : conversionByChannel(crm.leads).slice(0, TOP_CHANNELS);
  const periodo = range.label;

  // Sin integración: el equipo ve el link para conectarla; el cliente, solo el aviso.
  const locked = (label: string, icon: "target" | "funnel" | "check" | "money", tab: "crm" | "meta") => (
    <KpiLocked
      label={label}
      icon={icon}
      note={`${tab === "crm" ? "CRM" : "Meta"} no conectado${internal ? " · Conectar" : ""}`}
      href={internal ? `${base}/${tab}` : undefined}
    />
  );

  return (
    <>
      <Topbar crumb={c.name} title="Vista general">
        <RangePicker basePath={base} period={range} />
      </Topbar>
      <section className="view">
        <div className="grid g4 mb-4">
          {!c.conn.crm ? (
            <>
              {locked("Conversión general", "target", "crm")}
              {locked("Conversión dentro de cada canal", "funnel", "crm")}
              {locked("Ventas", "check", "crm")}
            </>
          ) : won === null ? (
            <>
              <KpiLocked label="Conversión general" icon="target" note="El CRM no informa qué se ganó" />
              <KpiLocked label="Conversión dentro de cada canal" icon="funnel" note="El CRM no informa qué se ganó" />
              <KpiLocked label="Ventas" icon="check" note="El CRM no informa qué se ganó" />
            </>
          ) : (
            <>
              <Kpi
                label="Conversión general"
                icon="target"
                value={orDash(safeDiv(won * 100, opportunities), (v) => percent(v))}
                sub={`ventas sobre oportunidades, ${periodo}`}
                hero
              />
              <div className="card kpi">
                <div className="top">
                  <span className="label">Conversión dentro de cada canal</span>
                  <span className="ico">
                    <Icon name="funnel" />
                  </span>
                </div>
                {channels.length ? (
                  <ul className="kpi-channels">
                    {channels.map((ch) => (
                      // Cada % es ventas sobre oportunidades de ese canal, no su parte del
                      // total: por eso va la base abajo y las filas no suman 100%.
                      <li key={ch.name}>
                        <span>
                          {ch.name}
                          <small>
                            {integer(ch.won)} de {integer(ch.leads)}
                          </small>
                        </span>
                        <b>{percent(ch.rate)}</b>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="kpi-note">Ninguna oportunidad del período tiene el origen cargado.</p>
                )}
              </div>
              <Kpi label="Ventas" icon="check" value={integer(won)} sub={`de ${integer(opportunities)} oportunidades, ${periodo}`} />
            </>
          )}

          {!c.conn.meta ? (
            locked("Nivel de inversión", "money", "meta")
          ) : daily.length ? (
            <Kpi label="Nivel de inversión" icon="money" value={money(spend)} sub={`en Meta, ${periodo}`} />
          ) : (
            <KpiLocked label="Nivel de inversión" icon="money" note="Sin datos sincronizados" />
          )}
        </div>

        {/* Apiladas y a todo el ancho: en dos columnas el gráfico de alcance queda
            demasiado angosto y el embudo aprieta los nombres de etapa. */}
        <div className="grid">
          {!c.conn.crm ? (
            <MissingIntegration kind="crm" client={c} internal={internal} />
          ) : (
            <Card title="Embudo de ventas" hint={`${integer(opportunities)} oportunidades, ${periodo}`}>
              {opportunities ? (
                <StageBars stages={leadFunnel(crm.leads)} />
              ) : (
                <EmptyState label="Sin datos">Ninguna oportunidad creada {periodPhrase(range)}.</EmptyState>
              )}
            </Card>
          )}
          {!c.conn.meta ? (
            <MissingIntegration kind="meta" client={c} internal={internal} />
          ) : (
            <Card title="Alcance e interacción" hint={period}>
              {daily.length ? (
                <LineChart
                  id="reach"
                  height={260}
                  labels={daily.map((d) => shortDate(d.date))}
                  series={[
                    { label: "Alcance", data: daily.map((d) => d.reach), color: "#B50CC5", fillOpacity: 0.2 },
                    { label: "Interacción", data: daily.map((d) => d.engagements ?? 0), color: "#FE6F61", fillOpacity: 0.16 },
                  ]}
                />
              ) : (
                <EmptyState label="Sin datos">Todavía no hay métricas diarias sincronizadas.</EmptyState>
              )}
            </Card>
          )}
        </div>
      </section>
    </>
  );
}
