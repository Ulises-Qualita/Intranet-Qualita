import { LineChart, StageBars } from "@/components/charts";
import { RangePicker } from "@/components/range-picker";
import { Topbar } from "@/components/topbar";
import { Card, EmptyState, Kpi, KpiLocked, MissingIntegration } from "@/components/ui";
import { type Client, crmPeriod, getLeads, getMetaDaily, leadFunnel } from "@/lib/data";
import { integer, money, orDash, percent, safeDiv, shortDate } from "@/lib/format";
import { type Period, periodPhrase } from "@/lib/period";

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
  // Mismo cálculo que la card "Leads generados" de la solapa META.
  const metaLeads = daily.reduce((total, d) => total + d.leads, 0);

  // Conversión = ventas ganadas sobre oportunidades creadas en el período. Sin la
  // columna de estado en el CRM (won === null) no hay forma de saber cuáles se
  // ganaron, y la card lo dice en vez de mostrar 0%.
  const crm = crmPeriod(leads, range);
  const won = crm.won;
  const opportunities = crm.leads.length;
  const periodo = range.label;

  // Sin integración: el equipo ve el link para conectarla; el cliente, solo el aviso.
  const locked = (label: string, icon: "target" | "users" | "check" | "money", tab: "crm" | "meta") => (
    <KpiLocked
      label={label}
      icon={icon}
      note={`${tab === "crm" ? "CRM" : "Meta"} no conectado${internal ? " · Conectar" : ""}`}
      href={internal ? `${base}/${tab}` : undefined}
    />
  );

  return (
    <>
      {/* El equipo tiene el encabezado, las solapas y el período en clientes/[id]/layout.tsx. */}
      {!internal && (
        <Topbar crumb={c.name} title="Vista general">
          <RangePicker basePath={base} period={range} />
        </Topbar>
      )}
      <section className="view">
        <div className="grid g4 mb-4">
          {!c.conn.crm ? (
            <>
              {locked("Conversión general", "target", "crm")}
              {locked("Ventas", "check", "crm")}
            </>
          ) : won === null ? (
            <>
              <KpiLocked label="Conversión general" icon="target" note="El CRM no informa qué se ganó" />
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
              <Kpi label="Ventas" icon="check" value={integer(won)} sub={`de ${integer(opportunities)} oportunidades, ${periodo}`} />
            </>
          )}

          {!c.conn.meta ? (
            <>
              {locked("Leads generados", "users", "meta")}
              {locked("Nivel de inversión", "money", "meta")}
            </>
          ) : daily.length ? (
            <>
              <Kpi label="Leads generados" icon="users" value={integer(metaLeads)} sub={`en Meta, ${periodo}`} />
              <Kpi label="Nivel de inversión" icon="money" value={money(spend)} sub={`en Meta, ${periodo}`} />
            </>
          ) : (
            <>
              <KpiLocked label="Leads generados" icon="users" note="Sin datos sincronizados" />
              <KpiLocked label="Nivel de inversión" icon="money" note="Sin datos sincronizados" />
            </>
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
