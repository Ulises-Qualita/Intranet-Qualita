import Link from "next/link";
import { LineChart } from "@/components/charts";
import { RangePicker } from "@/components/range-picker";
import { Topbar } from "@/components/topbar";
import { Card, EmptyState, Kpi, MissingIntegration } from "@/components/ui";
import { type Client, getMetaCampaigns, getMetaDaily } from "@/lib/data";
import { compact, integer, money, orDash, percent, relativeTime, safeDiv, shortDate, todayISO } from "@/lib/format";
import { META_HISTORY_DAYS, type Period, periodPhrase, shiftDate } from "@/lib/period";
import { prepareMetaView } from "@/lib/meta-sync";
import { CampaignTable } from "./campaign-table";

// Métricas de META de un cliente. La usan el equipo (/clientes/[slug]/meta) y la
// cuenta del propio cliente (/mi-empresa/meta): quien la llama ya validó el
// acceso. Con `internal` en false no se muestran los avisos de sincronización ni
// los links para reconectar, que son tarea del equipo.
export async function MetaView({
  c,
  range,
  base,
  internal,
  anuncio,
}: {
  c: Client;
  range: Period;
  base: string;
  internal: boolean;
  anuncio?: string;
}) {
  if (!c.conn.meta) {
    return (
      <>
        <Topbar crumb={c.name} title="Métricas de META" />
        <section className="view">
          <MissingIntegration kind="meta" client={c} internal={internal} />
        </section>
      </>
    );
  }

  // El sync guarda solo los últimos 90 días: un rango que empieza antes queda
  // con el principio vacío, y se avisa para que no parezca que no hubo entrega.
  const beforeHistory = range.since < shiftDate(todayISO(), META_HISTORY_DAYS);

  // Asegura datos la primera vez y programa el refresco si quedaron viejos.
  const secrets = await prepareMetaView(c.id, c.integrations.meta.accountRef);
  const [daily, campaigns] = await Promise.all([getMetaDaily(c.id, range), getMetaCampaigns(c.id, range)]);

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
        <RangePicker basePath={`${base}/meta`} period={range} />
      </Topbar>
      <section className="view">
        {internal && secrets?.sync_error && <p className="form-error">{secrets.sync_error}</p>}
        {beforeHistory && (
          <p className="hint-text mb-4">
            Meta guarda los últimos {META_HISTORY_DAYS} días: antes de esa fecha no hay datos para mostrar.
          </p>
        )}
        {internal && !secrets && (
          <p className="form-error">
            La sesión de Facebook venció. <Link href={`/clientes/${c.slug}/meta/conectar`}>Volvé a conectar Meta</Link> para
            seguir actualizando las métricas.
          </p>
        )}

        {daily.length === 0 ? (
          <Card title="Métricas" className="mb-4">
            <EmptyState label="Sin datos">
              No hay entrega registrada {periodPhrase(range)} para esta cuenta publicitaria.
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
            <EmptyState label="Sin datos">Ningún anuncio tuvo entrega {periodPhrase(range)}.</EmptyState>
          ) : (
            <CampaignTable campaigns={campaigns} clientSlug={c.slug} highlight={anuncio} />
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
