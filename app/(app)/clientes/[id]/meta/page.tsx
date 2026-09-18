import Link from "next/link";
import { notFound } from "next/navigation";
import { LineChart } from "@/components/charts";
import { RangePicker, readRange } from "@/components/range-picker";
import { Topbar } from "@/components/topbar";
import { Card, ConnectState, EmptyState, Kpi, NoAccess } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { getClient, getMetaCampaigns, getMetaDaily } from "@/lib/data";
import { compact, integer, money, orDash, percent, relativeTime, safeDiv, shortDate } from "@/lib/format";
import { prepareMetaView } from "@/lib/meta-sync";
import { CampaignTable } from "./campaign-table";

export default async function ClienteMetaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ dias?: string; anuncio?: string }>;
}) {
  const [{ id }, { dias, anuncio }] = await Promise.all([params, searchParams]);
  const days = readRange(dias);
  const session = await getAreaSession("meta");
  if (!session) {
    return (
      <>
        <Topbar crumb="Clientes" title="Métricas de META" />
        <NoAccess />
      </>
    );
  }

  const c = await getClient(id);
  if (!c) notFound();

  if (!c.conn.meta) {
    return (
      <>
        <Topbar crumb={c.name} title="Métricas de META" />
        <section className="view">
          <ConnectState kind="meta" client={c} />
        </section>
      </>
    );
  }

  // Asegura datos la primera vez y programa el refresco si quedaron viejos.
  const secrets = await prepareMetaView(c.id, c.integrations.meta.accountRef);
  const [daily, campaigns] = await Promise.all([getMetaDaily(c.id, days), getMetaCampaigns(c.id, days)]);

  const sum = (key: "spend" | "leads" | "impressions" | "clicks") =>
    daily.reduce((acc, d) => acc + d[key], 0);
  const spend = sum("spend");
  const leads = sum("leads");
  const impressions = sum("impressions");
  const clicks = sum("clicks");
  const period = daily.length ? `${shortDate(daily[0].date)} – ${shortDate(daily.at(-1)!.date)}` : "sin datos";

  const updated = secrets?.synced_at ? relativeTime(secrets.synced_at) : null;

  return (
    <>
      <Topbar crumb={c.name} title="Métricas de META">
        <RangePicker basePath={`/clientes/${c.slug}/meta`} days={days} />
      </Topbar>
      <section className="view">
        {secrets?.sync_error && <p className="form-error">{secrets.sync_error}</p>}
        {!secrets && (
          <p className="form-error">
            La sesión de Facebook venció. <Link href={`/clientes/${c.slug}/meta/conectar`}>Volvé a conectar Meta</Link> para
            seguir actualizando las métricas.
          </p>
        )}

        {daily.length === 0 ? (
          <Card title="Métricas" className="mb-4">
            <EmptyState label="Sin datos">
              No hay entrega registrada en los últimos {days} días para esta cuenta publicitaria.
            </EmptyState>
          </Card>
        ) : (
          <>
            <div className="grid g3 mb-4">
              <Kpi label="Gasto total" icon="money" value={money(spend)} sub={period} hero />
              <Kpi label="Costo por lead (CPL)" icon="target" value={orDash(safeDiv(spend, leads), (v) => money(v, 2))} sub={period} />
              <Kpi label="Leads generados" icon="users" value={integer(leads)} sub={period} />
            </div>
            <div className="grid g3 mb-4">
              <Kpi label="Impresiones" icon="eye" value={compact(impressions)} sub={period} />
              <Kpi label="CTR" icon="reach" value={orDash(safeDiv(clicks * 100, impressions), (v) => percent(v))} sub={period} />
              <Kpi label="CPM" icon="bolt" value={orDash(safeDiv(spend * 1000, impressions), (v) => money(v, 2))} sub={period} />
            </div>
          </>
        )}

        <Card
          title="Campañas y anuncios"
          hint={campaigns.length ? `${campaigns.length} ${campaigns.length === 1 ? "campaña" : "campañas"} · ${period}` : undefined}
          className="mb-4"
        >
          {campaigns.length === 0 ? (
            <EmptyState label="Sin datos">Ningún anuncio tuvo entrega en los últimos {days} días.</EmptyState>
          ) : (
            <CampaignTable campaigns={campaigns} highlight={anuncio} />
          )}
        </Card>

        {daily.length > 0 && (
          <Card title="Gasto diario en anuncios" hint={updated ? `${period} · actualizado ${updated}` : period}>
            <LineChart
              id="spend"
              labels={daily.map((d) => shortDate(d.date))}
              series={[{ label: "Gasto", data: daily.map((d) => d.spend), color: "#FE6F61", fillOpacity: 0.22 }]}
            />
          </Card>
        )}
      </section>
    </>
  );
}
