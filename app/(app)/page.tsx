import Link from "next/link";
import { ClientAvatar } from "@/components/client-avatar";
import { Topbar } from "@/components/topbar";
import { Card, EmptyState, Kpi, NoAccess } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { canAccess } from "@/lib/auth-shared";
import { getClientProjects, getClients, getMetaSpendByClient, getTeam } from "@/lib/data";
import { UserAvatar } from "@/components/user-avatar";
import { greeting, longToday, integer, money, shortDate, todayISO } from "@/lib/format";
import { PILLARS, pillarTimeline, type NotionProject, type TimelineStep } from "@/lib/notion-map";

// Período de los leads de Meta que muestra el KPI del estudio.
const META_DAYS = 30;
// Clientes a cargo que entran como accesos directos en el saludo; el resto va como "+N más".
const WELCOME_CLIENTS = 5;

// Clientes que no van en la tabla de Etapas del proyecto de Inicio (pedido): el de
// prueba. Por slug, que no cambia si lo renombran; siguen visibles en Clientes.
const HIDDEN_IN_STAGES = new Set(["cliente-de-prueba-mati"]);

const STEP_LABEL = { done: "Terminado", current: "En curso", upcoming: "Próximo", missing: "Sin fecha" } as const;

const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

// Fechas de cada pilar, arriba de su tramo: "22 oct → 22 nov", "Desde 12 oct" o "Sin fecha".
const stepDates = (s: TimelineStep) =>
  !s.start ? "Sin fecha" : s.end ? `${shortDate(s.start)} → ${shortDate(s.end)}` : `Desde ${shortDate(s.start)}`;

// Detalle de cada pilar para el tooltip: fechas si terminó, el avance si está en
// curso, cuándo arranca si viene después.
function stepDetail(s: TimelineStep, today: string) {
  if (!s.start) return "Sin fecha";
  if (s.state === "current") {
    return s.end
      ? `Día ${days(s.start, today) + 1} de ${days(s.start, s.end) + 1} · hasta ${shortDate(s.end)}`
      : `Desde ${shortDate(s.start)}`;
  }
  if (s.state === "upcoming") return `Arranca ${shortDate(s.start)}`;
  return s.end ? `${shortDate(s.start)} → ${shortDate(s.end)}` : `Desde ${shortDate(s.start)}`;
}

// Línea de tiempo del cliente (variante C5 elegida por el usuario), con la misma
// "magia" que la línea de Hitos del portal. Cada pilar es un tramo que termina en un
// hito a la derecha (pedido: el tilde va al cerrar la etapa, no al empezarla).
// Terminado = tramo lleno y hito con tilde; en curso = tramo llenándose con una luz
// en la punta y el hito como anillo, la meta; sin fin (Motor de Demanda) = tramo
// que corre y se desvanece, sin hito; próximo = tramo gris y hito vacío.
function PillarTimeline({ steps, today }: { steps: TimelineStep[]; today: string }) {
  return (
    <ol className="ptl">
      {steps.map((s, i) => {
        const ongoing = s.state === "current" && s.progress === null;
        const travelling = s.state === "current" && s.progress !== null;
        const fill = s.state === "done" || ongoing ? 1 : travelling ? s.progress! / 100 : 0;
        return (
          <li
            key={s.name}
            className={`ptl-item ${s.state}`}
            style={{ "--i": i, "--fill": fill } as React.CSSProperties}
            title={`${s.name} · ${stepDetail(s, today)}`}
          >
            {/* Fechas arriba, línea al medio y pill abajo (pedido). Fechas y pill tienen el
                mismo alto, así la línea queda centrada en la fila. */}
            <small className="ptl-when">{stepDates(s)}</small>
            <div className="ptl-head" aria-hidden>
              <i className={`ptl-conn${travelling ? " travelling" : ""}${ongoing ? " ongoing" : ""}`}>
                {/* El % según las fechas: adentro de lo recorrido si entra, si no, a continuación. */}
                {(s.state === "done" || travelling) && (
                  <span className={`ptl-pct${fill >= 0.3 ? " in" : ""}`}>{Math.round(fill * 100)}%</span>
                )}
              </i>
              {!ongoing && (
                <span className="ptl-dot">
                  {/* Tilde propio (no el ícono genérico): trazo redondeado que se dibuja al aparecer. */}
                  {s.state === "done" && (
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none">
                      <path d="M6 12.5l3.8 3.8L18 8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" pathLength={1} />
                    </svg>
                  )}
                </span>
              )}
            </div>
            <span className="ptl-name">{s.name}</span>
            <span className="pt-sr">{STEP_LABEL[s.state]}</span>
          </li>
        );
      })}
    </ol>
  );
}

export default async function InicioPage() {
  const session = await getAreaSession("inicio");
  if (!session) {
    return (
      <>
        <Topbar crumb="Qualita" title="Inicio" />
        <NoAccess />
      </>
    );
  }

  // Los leads del KPI salen de las métricas sincronizadas de Meta: solo para
  // quien puede ver META y de los clientes que la tienen conectada.
  const [clients, team] = await Promise.all([getClients(), getTeam()]);
  const seesMeta = canAccess(session.profile, "meta");
  const metaClients = seesMeta ? clients.filter((c) => c.conn.meta) : [];
  const [spendByClient, projects] = await Promise.all([
    getMetaSpendByClient(metaClients.map((c) => c.id), META_DAYS),
    getClientProjects(clients),
  ]);
  const today = todayISO();
  // Una columna por pilar, alineadas entre clientes como un Gantt. Consultoría solo
  // si algún cliente la tiene con fechas.
  const pillarColumns = PILLARS.filter(
    (name) => name !== "Consultoría" || [...projects.values()].some((p) => p.pillars.some((x) => x.name === name)),
  );

  const countBy = (status: string) => clients.filter((c) => c.status === status).length;
  const activeMembers = team.filter((m) => m.active);
  // Total del estudio en Meta: la suma de lo de cada cliente.
  const metaTotal = [...spendByClient.values()].reduce(
    (t, s) => ({ spend: t.spend + s.spend, leads: t.leads + s.leads }),
    { spend: 0, leads: 0 },
  );

  // El saludo es personal: solo lo que tiene a cargo quien está mirando. Los KPIs
  // de abajo son del estudio, por eso el texto dice "tenés".
  const mine = clients.filter((c) => c.assigneeIds.includes(session.user.id));
  const seesClients = canAccess(session.profile, "clientes");
  const unassigned = clients.filter((c) => c.assigneeIds.length === 0).length;

  return (
    <>
      <Topbar crumb="Qualita" title="Inicio" />
      <section className="view">
        <div className="card welcome mb-4">
          <span className="welcome-ring">
            <UserAvatar className="welcome-av" name={session.user.name} avatarUrl={session.user.avatarUrl} />
          </span>
          <div className="welcome-txt">
            <h2>
              {greeting()}, <span className="welcome-name">{session.user.name.split(" ")[0]}</span>
            </h2>
            <p>
              <span className="welcome-date">{longToday()}</span>
              {" · "}
              {mine.length === 0
                ? "No tenés clientes a cargo."
                : `Tenés ${mine.length} cliente${mine.length === 1 ? "" : "s"} a cargo.`}
            </p>
          </div>
          {/* Accesos directos a los clientes a cargo: pastillas con logo y nombre. */}
          {mine.length > 0 && (
            <ul className="welcome-clients" aria-label="Tus clientes">
              {mine.slice(0, WELCOME_CLIENTS).map((c) => {
                const body = (
                  <>
                    <span aria-hidden>
                      <ClientAvatar client={c} />
                    </span>
                    <span className="welcome-pill-name">{c.name}</span>
                  </>
                );
                return (
                  <li key={c.id}>
                    {seesClients ? (
                      <Link href={`/clientes/${c.slug}`} className="welcome-pill">
                        {body}
                      </Link>
                    ) : (
                      <span className="welcome-pill">{body}</span>
                    )}
                  </li>
                );
              })}
              {mine.length > WELCOME_CLIENTS && (
                <li>
                  <span className="welcome-pill more" title={`${mine.length - WELCOME_CLIENTS} clientes más`}>
                    +{mine.length - WELCOME_CLIENTS}
                  </span>
                </li>
              )}
            </ul>
          )}
        </div>

        <div className="grid g4 mb-4">
          <Kpi label="Clientes" icon="briefcase" value={countBy("cliente")} sub={`de ${clients.length} en total`} hero />
          <Kpi label="En onboarding" icon="target" value={countBy("onboarding")} sub={`${countBy("lead")} lead${countBy("lead") === 1 ? "" : "s"} en seguimiento`} />
          {/* Sin acceso a META (o sin cuentas conectadas) no hay leads que mostrar:
              en su lugar va cuántos clientes siguen sin nadie con acceso al cliente. */}
          {metaClients.length > 0 ? (
            <Kpi
              label={`Leads generados, ${META_DAYS} días`}
              icon="funnel"
              value={integer(metaTotal.leads)}
              sub={`${metaTotal.leads > 0 ? `CPL promedio ${money(metaTotal.spend / metaTotal.leads)} · ` : ""}${metaClients.length} cliente${metaClients.length === 1 ? "" : "s"}`}
            />
          ) : (
            <Kpi
              label="Sin acceso al cliente"
              icon="team"
              value={unassigned}
              sub={`de ${clients.length} cliente${clients.length === 1 ? "" : "s"}`}
            />
          )}
          <Kpi label="Miembros del equipo" icon="users" value={activeMembers.length} sub="activos en Qualita" />
        </div>

        <Card title="Clientes">
          {clients.length === 0 ? (
            <EmptyState label="Sin clientes">Creá el primero desde la solapa Clientes.</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="ctable ptl-table">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>
                      {/* Mismo ancho y centrado que la línea de etapas, así el título arranca donde ella. */}
                      <span className="ptl-th">Etapas del proyecto</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {/* Primero los que tienen proyecto en Notion; los demás, abajo. */}
                  {clients.filter((c) => !HIDDEN_IN_STAGES.has(c.slug)).sort((a, b) => Number(projects.has(b.id)) - Number(projects.has(a.id))).map((c) => {
                    const project = projects.get(c.id);
                    const steps = project ? pillarTimeline(project, today) : [];
                    return (
                      <tr key={c.id} className="link-row">
                        <td>
                          <Link href={`/clientes/${c.slug}`} className="cl-cell">
                            <ClientAvatar client={c} />
                            <b>{c.name}</b>
                          </Link>
                        </td>
                        <td className="ptl-cell">
                          {project ? (
                            <PillarTimeline
                              steps={steps.filter((s) => pillarColumns.includes(s.name as (typeof PILLARS)[number]))}
                              today={today}
                            />
                          ) : (
                            <span className="muted">{c.conn.notion ? "Sin datos de Notion" : "Sin proyecto de Notion conectado"}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>
    </>
  );
}
