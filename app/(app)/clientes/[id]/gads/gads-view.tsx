import Link from "next/link";
import { LineChart } from "@/components/charts";
import { SyncStatus } from "@/components/sync-status";
import { Card, EmptyState, Kpi, Pill } from "@/components/ui";
import { type Better, compare } from "@/lib/compare";
import { type Client, type GadsCampaign, type GadsMetrics, getGadsCampaigns, getGadsDaily, getGadsFirstDate } from "@/lib/data";
import { compact, integer, money, orDash, percent, safeDiv, shortDate, todayISO } from "@/lib/format";
import { formatCustomerId } from "@/lib/google-ads";
import { prepareGadsView } from "@/lib/google-ads-sync";
import { GADS_HISTORY_DAYS, type Period, periodPhrase, previousPeriod, shiftDate, versusLabel } from "@/lib/period";

// Métricas de Google Ads de un cliente, solo para el equipo. Lee lo que guardó el
// sync (lib/google-ads-sync.ts); la API no se consulta al abrir la vista salvo
// para el backfill de un cliente recién conectado.

const CHANNELS: Record<string, string> = {
  SEARCH: "Búsqueda",
  PERFORMANCE_MAX: "Máximo rendimiento",
  DISPLAY: "Display",
  VIDEO: "Video",
  SHOPPING: "Shopping",
  DEMAND_GEN: "Demand Gen",
  MULTI_CHANNEL: "App",
  LOCAL: "Local",
  SMART: "Inteligente",
};

const StatusPill = ({ status }: { status: string | null }) =>
  status === "ENABLED" ? (
    <Pill variant="activo">Activa</Pill>
  ) : (
    <Pill variant="pausado">{status === "REMOVED" ? "Eliminada" : "Pausada"}</Pill>
  );

const totals = (rows: GadsMetrics[]) => {
  const sum = (key: keyof GadsMetrics) => rows.reduce((acc, r) => acc + r[key], 0);
  const [cost, clicks, impressions, conversions] = [sum("cost"), sum("clicks"), sum("impressions"), sum("conversions")];
  return {
    cost,
    clicks,
    conversions,
    cpa: safeDiv(cost, conversions),
    ctr: safeDiv(clicks * 100, impressions),
    cpc: safeDiv(cost, clicks),
  };
};

// Las conversiones de Google vienen con decimales (atribución fraccionada).
const conv = (v: number) => (Number.isInteger(v) ? integer(v) : v.toLocaleString("es-AR", { maximumFractionDigits: 1 }));

export async function GadsView({ c, range }: { c: Client; range: Period }) {
  const accountRef = c.integrations.google_ads.accountRef;
  const beforeHistory = range.since < shiftDate(todayISO(), GADS_HISTORY_DAYS);

  // Asegura datos la primera vez y programa el refresco si quedaron viejos.
  const secrets = await prepareGadsView(c.id, accountRef);
  const previous = previousPeriod(range);
  const [daily, campaigns, before, firstDate] = await Promise.all([
    getGadsDaily(c.id, range),
    getGadsCampaigns(c.id, range),
    getGadsDaily(c.id, previous),
    getGadsFirstDate(c.id),
  ]);

  const now = totals(daily);
  const period = daily.length ? `${shortDate(daily[0].date)} – ${shortDate(daily.at(-1)!.date)}` : "sin datos";

  // Solo se compara si el período anterior está entero dentro de lo guardado.
  const comparable = !!firstDate && firstDate <= previous.since && before.length > 0;
  const then = comparable ? totals(before) : null;
  const versus = versusLabel(range);
  const change = (key: keyof typeof now, better: Better, format: (value: number) => string) =>
    then ? compare(now[key], then[key], { better, format, versus: `Antes (${previous.label})` }) : null;

  return (
    <section className="view">
      <SyncStatus source="Google Ads" at={secrets?.synced_at} error={secrets?.sync_error} internal>
        {accountRef && (
          <Link href={`/clientes/${c.slug}/gads/conectar`} className="link-connect">
            Cuenta {formatCustomerId(accountRef)} · Cambiar
          </Link>
        )}
      </SyncStatus>
      {beforeHistory && (
        <p className="hint-text mb-4">
          Se guardan los últimos {GADS_HISTORY_DAYS} días de Google Ads: antes de esa fecha no hay datos para mostrar.
        </p>
      )}

      {daily.length === 0 ? (
        <Card title="Métricas" className="mb-4">
          <EmptyState label="Sin datos">No hay actividad registrada {periodPhrase(range)} en esta cuenta de Google Ads.</EmptyState>
        </Card>
      ) : (
        <>
          <div className="grid g3 mb-4">
            {/* Gastar más no es mejor ni peor: el gasto va sin color. En costo por conversión y CPC, bajar es mejorar. */}
            <Kpi label="Gasto total" icon="money" value={money(now.cost)} sub={period} hero change={change("cost", "neutral", (v) => money(v))} versus={versus} />
            <Kpi
              label="Costo por conversión"
              icon="target"
              value={orDash(now.cpa, (v) => money(v, 2))}
              sub={period}
              change={change("cpa", "down", (v) => money(v, 2))}
              versus={versus}
            />
            <Kpi label="Conversiones" icon="check" value={conv(now.conversions)} sub={period} change={change("conversions", "up", conv)} versus={versus} />
          </div>
          <div className="grid g3 mb-4">
            <Kpi label="Clics" icon="arrow-out" value={compact(now.clicks)} sub={period} change={change("clicks", "up", compact)} versus={versus} />
            <Kpi label="CTR" icon="reach" value={orDash(now.ctr, (v) => percent(v))} sub={period} change={change("ctr", "up", (v) => percent(v))} versus={versus} />
            <Kpi
              label="CPC promedio"
              icon="bolt"
              value={orDash(now.cpc, (v) => money(v, 2))}
              sub={period}
              change={change("cpc", "down", (v) => money(v, 2))}
              versus={versus}
            />
          </div>
        </>
      )}

      <Card
        title="Campañas"
        hint={campaigns.length ? `${campaigns.length} ${campaigns.length === 1 ? "campaña" : "campañas"} · ${period}` : undefined}
        className="mb-4"
      >
        {campaigns.length === 0 ? (
          <EmptyState label="Sin datos">Ninguna campaña tuvo impresiones {periodPhrase(range)}.</EmptyState>
        ) : (
          <CampaignTable campaigns={campaigns} />
        )}
      </Card>

      {daily.length > 0 && (
        <Card title="Gasto diario en Google Ads" hint={period}>
          <LineChart
            id="gads-spend"
            labels={daily.map((d) => shortDate(d.date))}
            series={[{ label: "Gasto", data: daily.map((d) => d.cost), color: "#FE6F61", fillOpacity: 0.22 }]}
          />
        </Card>
      )}
    </section>
  );
}

function CampaignTable({ campaigns }: { campaigns: GadsCampaign[] }) {
  return (
    <div className="table-wrap">
      <table className="ctable">
        <thead>
          <tr>
            <th>Campaña</th>
            <th>Estado</th>
            <th>Gasto</th>
            <th>Conversiones</th>
            <th>Costo / conv.</th>
            <th>Clics</th>
            <th>CTR</th>
            <th>CPC</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((row) => (
            <tr key={row.id}>
              <td>
                <b>{row.name}</b>
                {row.channel && <span className="camp-count gads-channel">{CHANNELS[row.channel] ?? row.channel}</span>}
              </td>
              <td>
                <StatusPill status={row.status} />
              </td>
              <td className="num">{money(row.cost)}</td>
              <td className="num">{conv(row.conversions)}</td>
              <td className="num">{orDash(safeDiv(row.cost, row.conversions), (v) => money(v, 2))}</td>
              <td className="num">{compact(row.clicks)}</td>
              <td>{orDash(safeDiv(row.clicks * 100, row.impressions), (v) => percent(v))}</td>
              <td className="num">{orDash(safeDiv(row.cost, row.clicks), (v) => money(v, 2))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
