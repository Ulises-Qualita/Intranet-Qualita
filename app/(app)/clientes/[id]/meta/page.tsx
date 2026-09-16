import { notFound } from "next/navigation";
import { LineChart } from "@/components/charts";
import { Icon } from "@/components/icons";
import { Topbar } from "@/components/topbar";
import { Card, ConnectState, EmptyState, Kpi, NoAccess, Pill } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { getClient, getMetaAds, getMetaDaily } from "@/lib/data";
import { compact, integer, money, percent, ratio, shortDate } from "@/lib/format";

const safeDiv = (a: number, b: number) => (b ? a / b : null);
const orDash = (value: number | null, fmt: (v: number) => string) => (value === null ? "—" : fmt(value));

export default async function ClienteMetaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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

  const [daily, ads] = await Promise.all([getMetaDaily(c.id), getMetaAds(c.id)]);

  const sum = (key: "spend" | "leads" | "impressions" | "clicks" | "conversions" | "revenue") =>
    daily.reduce((acc, d) => acc + d[key], 0);
  const spend = sum("spend");
  const leads = sum("leads");
  const impressions = sum("impressions");
  const clicks = sum("clicks");
  const revenue = sum("revenue");
  const period = daily.length ? `${shortDate(daily[0].date)} – ${shortDate(daily.at(-1)!.date)}` : "sin datos";

  return (
    <>
      <Topbar crumb={c.name} title="Métricas de META" />
      <section className="view">
        {daily.length === 0 ? (
          <Card title="Métricas" className="mb-4">
            <EmptyState label="Sin datos">Todavía no hay métricas diarias sincronizadas para este cliente.</EmptyState>
          </Card>
        ) : (
          <>
            <div className="grid g4 mb-4">
              <Kpi label="Gasto total" icon="money" value={money(spend)} sub={period} hero />
              <Kpi label="Costo por lead (CPL)" icon="target" value={orDash(safeDiv(spend, leads), (v) => money(v, 2))} sub={period} />
              <Kpi label="Leads generados" icon="users" value={integer(leads)} sub={period} />
              <Kpi label="ROAS" icon="bolt" value={orDash(safeDiv(revenue, spend), ratio)} sub={period} />
            </div>
            <div className="grid g4 mb-4">
              <Kpi label="Impresiones" icon="eye" value={compact(impressions)} sub={period} />
              <Kpi label="CTR" icon="reach" value={orDash(safeDiv(clicks * 100, impressions), (v) => percent(v))} sub={period} />
              <Kpi label="CPM" icon="bolt" value={orDash(safeDiv(spend * 1000, impressions), (v) => money(v, 2))} sub={period} />
              <Kpi label="Conversiones" icon="check" value={integer(sum("conversions"))} sub={period} />
            </div>
          </>
        )}

        <Card
          title="Anuncios individuales"
          hint={ads.length ? `${ads.length} anuncios · al ${shortDate(ads[0].as_of)}` : undefined}
          className="mb-4"
        >
          {ads.length === 0 ? (
            <EmptyState label="Sin datos">Todavía no hay anuncios sincronizados.</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="ctable">
                <thead>
                  <tr>
                    <th>Anuncio</th>
                    <th>Estado</th>
                    <th>Gasto</th>
                    <th>Leads</th>
                    <th>CPL</th>
                    <th>CTR</th>
                    <th>Impresiones</th>
                  </tr>
                </thead>
                <tbody>
                  {ads.map((ad) => (
                    <tr key={ad.id}>
                      <td>
                        <div className="cl-cell">
                          <div className="thumb-sm">
                            <Icon name="media" />
                          </div>
                          <b>{ad.name}</b>
                        </div>
                      </td>
                      <td>
                        {ad.status === "activo" ? <Pill variant="activo">Activo</Pill> : <Pill variant="pausado">Pausado</Pill>}
                      </td>
                      <td className="num">{money(ad.spend)}</td>
                      <td className="num">{integer(ad.leads)}</td>
                      <td className="num">{orDash(safeDiv(ad.spend, ad.leads), (v) => money(v, 2))}</td>
                      <td>{orDash(safeDiv(ad.clicks * 100, ad.impressions), (v) => percent(v))}</td>
                      <td>{compact(ad.impressions)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {daily.length > 0 && (
          <Card title="Gasto diario en anuncios" hint={period}>
            <LineChart
              id="spend"
              height={180}
              labels={daily.map((d) => shortDate(d.date))}
              series={[{ label: "Gasto", data: daily.map((d) => d.spend), color: "#FE6F61", fillOpacity: 0.22 }]}
            />
          </Card>
        )}
      </section>
    </>
  );
}
