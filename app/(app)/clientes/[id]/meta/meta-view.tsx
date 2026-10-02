import Link from "next/link";
import { LineChart } from "@/components/charts";
import { RangePicker } from "@/components/range-picker";
import { SyncStatus } from "@/components/sync-status";
import { Topbar } from "@/components/topbar";
import { Card, EmptyState, Kpi, MissingIntegration } from "@/components/ui";
import { type Better, compare } from "@/lib/compare";
import { type Client, getMetaCampaigns, getMetaDaily, getMetaFirstDate, type MetaDaily } from "@/lib/data";
import { compact, integer, money, orDash, percent, safeDiv, shortDate, todayISO } from "@/lib/format";
import { META_HISTORY_DAYS, type Period, periodPhrase, previousPeriod, shiftDate, versusLabel } from "@/lib/period";
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
        {!internal && <Topbar crumb={c.name} title="Métricas de META" />}
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
  // Para comparar: el período anterior del mismo largo, y desde cuándo hay datos.
  const previous = previousPeriod(range);
  const [daily, campaigns, before, firstDate] = await Promise.all([
    getMetaDaily(c.id, range),
    getMetaCampaigns(c.id, range),
    getMetaDaily(c.id, previous),
    getMetaFirstDate(c.id),
  ]);

  const totals = (rows: MetaDaily[]) => {
    const sum = (key: "spend" | "leads" | "impressions" | "clicks") => rows.reduce((acc, d) => acc + d[key], 0);
    const [spend, leads, impressions, clicks] = [sum("spend"), sum("leads"), sum("impressions"), sum("clicks")];
    return {
      spend,
      leads,
      impressions,
      cpl: safeDiv(spend, leads),
      ctr: safeDiv(clicks * 100, impressions),
      cpm: safeDiv(spend * 1000, impressions),
    };
  };
  const now = totals(daily);
  const period = daily.length ? `${shortDate(daily[0].date)} – ${shortDate(daily.at(-1)!.date)}` : "sin datos";

  // Solo se compara si el período anterior está entero dentro de lo guardado: con
  // la mitad de los días, cualquier número daría una suba que no existió.
  const comparable = !!firstDate && firstDate <= previous.since && before.length > 0;
  const then = comparable ? totals(before) : null;
  const versus = versusLabel(range);
  const change = (key: keyof typeof now, better: Better, format: (value: number) => string) =>
    then ? compare(now[key], then[key], { better, format, versus: `Antes (${previous.label})` }) : null;


  return (
    <>
      {/* El equipo tiene el encabezado, las solapas y el período en clientes/[id]/layout.tsx. */}
      {!internal && (
        <Topbar crumb={c.name} title="Métricas de META">
          <RangePicker basePath={`${base}/meta`} period={range} />
        </Topbar>
      )}
      <section className="view">
        {/* Sin secrets = la sesión de Facebook venció (prepareMetaView). */}
        <SyncStatus
          source="Meta Ads"
          at={secrets?.synced_at}
          error={
            secrets ? (
              secrets.sync_error
            ) : (
              <>
                La sesión de Facebook venció.{" "}
                <Link href={`/clientes/${c.slug}/meta/conectar`}>Volvé a conectar Meta</Link> para seguir actualizando las
                métricas.
              </>
            )
          }
          internal={internal}
        />
        {beforeHistory && (
          <p className="hint-text mb-4">
            Meta guarda los últimos {META_HISTORY_DAYS} días: antes de esa fecha no hay datos para mostrar.
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
              {/* Gastar más no es mejor ni peor: el gasto va sin color. En CPL y CPM, bajar es mejorar. */}
              <Kpi label="Gasto total" icon="money" value={money(now.spend)} sub={period} hero change={change("spend", "neutral", (v) => money(v))} versus={versus} />
              <Kpi
                label="Costo por lead (CPL)"
                icon="target"
                value={orDash(now.cpl, (v) => money(v, 2))}
                sub={period}
                change={change("cpl", "down", (v) => money(v, 2))}
                versus={versus}
              />
              <Kpi label="Leads generados" icon="users" value={integer(now.leads)} sub={period} change={change("leads", "up", integer)} versus={versus} />
            </div>
            <div className="grid g3 mb-4">
              <Kpi label="Impresiones" icon="eye" value={compact(now.impressions)} sub={period} change={change("impressions", "up", compact)} versus={versus} />
              <Kpi label="CTR" icon="reach" value={orDash(now.ctr, (v) => percent(v))} sub={period} change={change("ctr", "up", (v) => percent(v))} versus={versus} />
              <Kpi label="CPM" icon="bolt" value={orDash(now.cpm, (v) => money(v, 2))} sub={period} change={change("cpm", "down", (v) => money(v, 2))} versus={versus} />
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
          <Card title="Gasto diario en anuncios" hint={period}>
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
