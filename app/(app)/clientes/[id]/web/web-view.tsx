import Link from "next/link";
import { LineChart, StageBars } from "@/components/charts";
import { SyncStatus } from "@/components/sync-status";
import { Topbar } from "@/components/topbar";
import { Card, EmptyState, Kpi, MissingIntegration } from "@/components/ui";
import { getClaritySecrets } from "@/lib/clarity";
import { type Client, getClarityDaily, getClarityPages } from "@/lib/data";
import { compact, integer, orDash, percent, safeDiv, shortDate } from "@/lib/format";
import { PagesTable } from "./pages-table";
import { RefreshClarity } from "./refresh-button";

// Segundos a "2m 34s": Clarity informa tiempos por sesión y en segundos crudos no
// se leen.
function duration(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  const total = Math.round(seconds);
  const min = Math.floor(total / 60);
  return min ? `${min}m ${total % 60}s` : `${total}s`;
}

// La URL de una página puede ser larguísima; en la tabla se muestra el camino.
function pagePath(url: string) {
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    return (parsed.pathname + parsed.search) || "/";
  } catch {
    return url;
  }
}

// Analítica del sitio de un cliente (Clarity). La usan el equipo
// (/clientes/[slug]/web) y la cuenta del propio cliente (/mi-empresa/web): quien
// la llama ya validó el acceso. `internal` muestra el botón para actualizar,
// los errores de sync y el link a la conexión, que son tarea del equipo.
export async function WebView({ client, base, internal }: { client: Client; base: string; internal: boolean }) {
  if (!client.conn.clarity) {
    return (
      <>
        {!internal && <Topbar crumb={client.name} title="WEB" />}
        <section className="view">
          <MissingIntegration kind="clarity" client={client} internal={internal} />
        </section>
      </>
    );
  }

  const [daily, pages, secrets] = await Promise.all([
    getClarityDaily(client.id),
    getClarityPages(client.id),
    getClaritySecrets(client.id),
  ]);

  const sum = (pick: (d: (typeof daily)[number]) => number) => daily.reduce((total, d) => total + pick(d), 0);
  const sessions = sum((d) => d.sessions);
  // Clarity cuenta visitas por página (una sesión puede ver varias): el share va
  // sobre el total de visitas, no de sesiones.
  const visits = pages.reduce((total, p) => total + p.sessions, 0);
  const last = daily.at(-1);
  const period = daily.length ? `${shortDate(daily[0].as_of)} – ${shortDate(daily.at(-1)!.as_of)}` : "";

  // Los promedios se sacan sobre los días que tienen el dato, no sobre todos: un
  // día sin tráfico bajaría el promedio como si hubiera medido cero.
  const average = (pick: (d: (typeof daily)[number]) => number | null) => {
    const values = daily.map(pick).filter((v): v is number => v !== null && Number.isFinite(v));
    return values.length ? values.reduce((total, v) => total + v, 0) / values.length : null;
  };

  const devices = new Map<string, number>();
  for (const d of daily) for (const dev of d.devices) devices.set(dev.name, (devices.get(dev.name) ?? 0) + dev.sessions);

  const friccion = [
    { name: "Rage clicks", value: sum((d) => d.rage_clicks) },
    { name: "Clics muertos", value: sum((d) => d.dead_clicks) },
    { name: "Scroll excesivo", value: sum((d) => d.excessive_scroll) },
    { name: "Vueltas rápidas", value: sum((d) => d.quickbacks) },
    { name: "Clics con error", value: sum((d) => d.error_clicks) },
  ].filter((f) => f.value > 0);

  return (
    <>
      {!internal && <Topbar crumb={client.name} title="WEB" />}

      <section className="view">
        {/* Clarity entrega una foto por día (ver lib/clarity-sync.ts). */}
        <SyncStatus source="Microsoft Clarity" at={secrets?.synced_at} error={secrets?.sync_error} internal={internal}>
          {internal && <RefreshClarity clientId={client.id} />}
        </SyncStatus>

        {!daily.length ? (
          <Card title="Sin datos todavía">
            <EmptyState label="Esperando la primera foto">
              Clarity solo entrega las últimas 72 horas, así que la intranet guarda una foto por día y arma la serie desde
              ahí. El historial anterior a la conexión no se puede recuperar.{" "}
              {internal && (
                <Link href={`${base}/web/conectar`} className="link-connect">
                  Revisar la conexión
                </Link>
              )}
            </EmptyState>
          </Card>
        ) : (
          <>
            <div className="grid g4 mb-4">
              <Kpi label="Sesiones" icon="reach" value={compact(sessions)} sub={period} hero />
              <Kpi
                label="Scroll"
                icon="eye"
                value={orDash(average((d) => d.scroll_depth), (v) => percent(v, 0))}
                sub="Profundidad promedio por página"
              />
              <Kpi
                label="Páginas por sesión"
                icon="media"
                value={orDash(average((d) => d.pages_per_session), (v) => v.toFixed(1))}
                sub="Promedio del período"
              />
              <Kpi
                label="Tiempo activo"
                icon="clock"
                value={duration(average((d) => d.active_time))}
                sub="Promedio por sesión"
              />
            </div>

            {/* El gráfico comparte fila con Dispositivos: a todo el ancho, con pocos días,
                quedaba estirado. */}
            <div className="grid g-2-1 items-stretch mb-4">
              <Card title="Sesiones por día" hint={period} className="fill-card">
                <LineChart
                  id="clarity"
                  height={240}
                  labels={daily.map((d) => shortDate(d.as_of))}
                  series={[
                    { label: "Sesiones", data: daily.map((d) => d.sessions), color: "#B50CC5", fillOpacity: 0.2 },
                    { label: "Bots", data: daily.map((d) => d.bot_sessions), color: "#FE6F61", fillOpacity: 0.14 },
                  ]}
                />
              </Card>

              <Card title="Dispositivos" hint={devices.size ? undefined : "Sin datos"} className="fill-card">
                {devices.size ? (
                  <StageBars
                    stages={[...devices.entries()]
                      .map(([name, value]) => ({ name, value }))
                      .sort((a, b) => b.value - a.value)}
                  />
                ) : (
                  <EmptyState label="Sin datos">Clarity no informó el corte por dispositivo.</EmptyState>
                )}
              </Card>
            </div>

            <Card title="Páginas más vistas" hint={pages.length ? `${pages.length} páginas` : undefined} className="mb-4">
              {pages.length ? (
                <PagesTable
                  rows={pages.map((p) => ({
                    url: p.url,
                    path: pagePath(p.url),
                    visits: integer(p.sessions),
                    share: orDash(safeDiv(p.sessions * 100, visits), (v) => percent(v)),
                  }))}
                />
              ) : (
                <EmptyState label="Sin datos">Todavía no hay páginas registradas en este período.</EmptyState>
              )}
            </Card>

            <Card
              title="Señales de fricción"
              hint="Dónde la gente se traba"
            >
              {friccion.length ? (
                <>
                  <div className="grid g3">
                    {friccion.map((f) => (
                      <div className="friction" key={f.name}>
                        <b>{integer(f.value)}</b>
                        <span>{f.name}</span>
                      </div>
                    ))}
                  </div>
                  <p className="modal-lead mt-4">
                    Un <b>rage click</b> es alguien clickeando repetido en el mismo lugar; un <b>clic muerto</b>, un clic en
                    algo que parece un botón y no lo es. Las <b>vueltas rápidas</b> son entrar a una página y volver enseguida.
                  </p>
                </>
              ) : (
                <EmptyState label="Sin señales">
                  Clarity no registró fricción en el período, o todavía no hay tráfico suficiente.
                </EmptyState>
              )}
            </Card>

            {last && (
              <p className="muted mt-4" style={{ fontSize: "12px" }}>
                La serie arranca el {shortDate(daily[0].as_of)}, el día de la primera sincronización. Clarity no permite
                traer datos anteriores.
              </p>
            )}
          </>
        )}
      </section>
    </>
  );
}
