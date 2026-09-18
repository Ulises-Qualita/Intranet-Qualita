import { notFound } from "next/navigation";
import { LineChart, StageBars } from "@/components/charts";
import { Topbar } from "@/components/topbar";
import { Card, ConnectState, EmptyState, Kpi, KpiLocked, NoAccess } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { getClient, getCrmSnapshot, getLeads, getMetaDaily, leadFunnel } from "@/lib/data";
import { compact, integer, shortDate } from "@/lib/format";

export default async function ClienteGeneralPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getAreaSession("clientes");
  if (!session) {
    return (
      <>
        <Topbar crumb="Clientes" title="Vista general" />
        <NoAccess />
      </>
    );
  }

  const c = await getClient(id);
  if (!c) notFound();

  const [daily, snapshot, leads] = await Promise.all([
    c.conn.meta ? getMetaDaily(c.id) : [],
    c.conn.crm ? getCrmSnapshot(c.id) : null,
    c.conn.crm ? getLeads(c.id) : [],
  ]);

  const base = `/clientes/${c.slug}`;
  const last = daily.at(-1);
  const period = daily.length ? `${shortDate(daily[0].date)} – ${shortDate(last!.date)}` : "";

  return (
    <>
      <Topbar crumb={c.name} title="Vista general" />
      <section className="view">
        <div className="grid g4 mb-4">
          {!c.conn.meta ? (
            <>
              <KpiLocked label="Alcance (Meta)" icon="reach" note="No conectado · Conectar" href={`${base}/meta`} />
              <KpiLocked label="Seguidores" icon="users" note="No conectado · Conectar" href={`${base}/meta`} />
            </>
          ) : last ? (
            <>
              <Kpi label="Alcance (Meta)" icon="reach" value={compact(last.reach)} sub={`al ${shortDate(last.date)}`} hero />
              {last.followers !== null ? (
                <Kpi label="Seguidores" icon="users" value={compact(last.followers)} sub={`al ${shortDate(last.date)}`} />
              ) : (
                <KpiLocked label="Seguidores" icon="users" note="Sin datos" />
              )}
            </>
          ) : (
            <>
              <KpiLocked label="Alcance (Meta)" icon="reach" note="Sin datos sincronizados" />
              <KpiLocked label="Seguidores" icon="users" note="Sin datos sincronizados" />
            </>
          )}

          {!c.conn.crm ? (
            <>
              <KpiLocked label="Leads en CRM" icon="target" note="No conectado · Conectar" href={`${base}/crm`} />
              <KpiLocked label="Conversaciones activas" icon="chat" note="No conectado · Conectar" href={`${base}/crm`} />
            </>
          ) : snapshot ? (
            <>
              <Kpi label="Leads en CRM" icon="target" value={integer(snapshot.leads_count)} sub={`al ${shortDate(snapshot.as_of)}`} />
              <Kpi label="Conversaciones activas" icon="chat" value={integer(snapshot.active_chats)} sub={`al ${shortDate(snapshot.as_of)}`} />
            </>
          ) : (
            <>
              <KpiLocked label="Leads en CRM" icon="target" note="Sin datos sincronizados" />
              <KpiLocked label="Conversaciones activas" icon="chat" note="Sin datos sincronizados" />
            </>
          )}
        </div>

        {/* Apiladas y a todo el ancho: en dos columnas el gráfico de alcance queda
            demasiado angosto y el embudo aprieta los nombres de etapa. */}
        <div className="grid">
          {!c.conn.crm ? (
            <ConnectState kind="crm" client={c} />
          ) : (
            <Card title="Embudo de ventas" hint={`${leads.length} leads`}>
              {leads.length ? (
                <StageBars stages={leadFunnel(leads)} />
              ) : (
                <EmptyState label="Sin datos">Todavía no hay leads sincronizados.</EmptyState>
              )}
            </Card>
          )}
          {!c.conn.meta ? (
            <ConnectState kind="meta" client={c} />
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
