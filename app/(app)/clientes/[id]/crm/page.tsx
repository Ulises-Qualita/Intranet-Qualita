import { notFound } from "next/navigation";
import { Funnel } from "@/components/charts";
import { Topbar } from "@/components/topbar";
import { Card, ConnectState, EmptyState, Kpi, KpiLocked, NoAccess, Pill } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { getClient, getCrmSnapshot, getLeads, leadFunnel } from "@/lib/data";
import { integer, money, percent, relativeTime, shortDate } from "@/lib/format";

const TEMPERATURE: Record<string, { label: string; variant: string }> = {
  new: { label: "Nuevo", variant: "new" },
  hot: { label: "Caliente", variant: "hot" },
  warm: { label: "Tibio", variant: "warm" },
  neg: { label: "Negociación", variant: "neg" },
};

export default async function ClienteCrmPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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

  const [snapshot, leads] = await Promise.all([getCrmSnapshot(c.id), getLeads(c.id)]);
  const asOf = snapshot ? `al ${shortDate(snapshot.as_of)}` : "";

  return (
    <>
      <Topbar crumb={c.name} title="CRM y ventas" />
      <section className="view">
        <div className="grid g4 mb-4">
          {snapshot ? (
            <>
              <Kpi label="Valor del pipeline" icon="funnel" value={money(snapshot.pipeline_value)} sub={asOf} hero />
              <Kpi label="Leads del período" icon="target" value={integer(snapshot.leads_count)} sub={asOf} />
              <Kpi label="Tasa de conversión" icon="bolt" value={percent(snapshot.conversion_rate, 1)} sub={asOf} />
              <Kpi label="Conversaciones activas" icon="chat" value={integer(snapshot.active_chats)} sub={asOf} />
            </>
          ) : (
            <>
              <KpiLocked label="Valor del pipeline" icon="funnel" note="Sin datos sincronizados" />
              <KpiLocked label="Leads del período" icon="target" note="Sin datos sincronizados" />
              <KpiLocked label="Tasa de conversión" icon="bolt" note="Sin datos sincronizados" />
              <KpiLocked label="Conversaciones activas" icon="chat" note="Sin datos sincronizados" />
            </>
          )}
        </div>

        <div className="grid g-2-1">
          <Card title="Etapas del embudo" hint={`${leads.length} leads`}>
            {leads.length ? (
              <Funnel stages={leadFunnel(leads)} />
            ) : (
              <EmptyState label="Sin datos">Todavía no hay leads sincronizados.</EmptyState>
            )}
          </Card>
          <Card title="Últimos leads">
            {leads.length === 0 ? (
              <EmptyState label="Sin datos">Sin leads.</EmptyState>
            ) : (
              leads.slice(0, 8).map((l) => {
                const temp = l.temperature ? TEMPERATURE[l.temperature] : undefined;
                return (
                  <div key={l.id} className="lead-row">
                    <div className="info">
                      <b>{l.name}</b>
                      <span>{[l.source, relativeTime(l.created_at)].filter(Boolean).join(" · ")}</span>
                    </div>
                    {l.amount !== null && <span className="amount">{money(l.amount)}</span>}
                    {temp && <Pill variant={temp.variant}>{temp.label}</Pill>}
                  </div>
                );
              })
            )}
          </Card>
        </div>
      </section>
    </>
  );
}
