import Link from "next/link";
import { ClientAvatar } from "@/components/client-avatar";
import { Icon } from "@/components/icons";
import { Topbar } from "@/components/topbar";
import { Card, EmptyState, Kpi, NoAccess, Pill } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { canAccess } from "@/lib/auth-shared";
import { statusMeta } from "@/lib/client-status";
import { getClients, getGadsSpendByClient, getMetaSpendByClient, getTeam } from "@/lib/data";
import { UserAvatar } from "@/components/user-avatar";
import { greeting, longToday, integer, money } from "@/lib/format";

// Período de la inversión (Meta + Google Ads) que muestra la tabla de clientes.
const META_DAYS = 30;
// Clientes a cargo que entran como accesos directos en el saludo; el resto va como "+N más".
const WELCOME_CLIENTS = 5;

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

  // La inversión de la tabla (Meta + Google Ads) sale de las métricas
  // sincronizadas: solo para quien puede ver META (el área de la publicidad, que
  // cubre las dos) y de los clientes que tienen alguna conectada.
  const [clients, team] = await Promise.all([getClients(), getTeam()]);
  const seesMeta = canAccess(session.profile, "meta");
  const metaClients = seesMeta ? clients.filter((c) => c.conn.meta) : [];
  const gadsClients = seesMeta ? clients.filter((c) => c.conn.google_ads) : [];
  const adClients = seesMeta ? clients.filter((c) => c.conn.meta || c.conn.google_ads) : [];
  const [spendByClient, gadsByClient] = await Promise.all([
    getMetaSpendByClient(metaClients.map((c) => c.id), META_DAYS),
    getGadsSpendByClient(gadsClients.map((c) => c.id), META_DAYS),
  ]);

  const countBy = (status: string) => clients.filter((c) => c.status === status).length;
  const activeMembers = team.filter((m) => m.active);
  // Total del estudio en Meta: la suma de lo que la tabla muestra por cliente.
  const metaTotal = [...spendByClient.values()].reduce(
    (t, s) => ({ spend: t.spend + s.spend, leads: t.leads + s.leads }),
    { spend: 0, leads: 0 },
  );

  // El saludo es personal: solo lo que tiene a cargo quien está mirando. Los KPIs
  // de abajo son del estudio, por eso el texto dice "tenés".
  const mine = clients.filter((c) => c.assigneeIds.includes(session.user.id));
  const seesClients = canAccess(session.profile, "clientes");

  const load = activeMembers
    .map((m) => ({ member: m, count: clients.filter((c) => c.assigneeIds.includes(m.id)).length }))
    .sort((a, b) => b.count - a.count);
  const maxLoad = Math.max(1, ...load.map((l) => l.count));
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
              en su lugar va cuántos clientes siguen sin responsable. */}
          {metaClients.length > 0 ? (
            <Kpi
              label={`Leads generados, ${META_DAYS} días`}
              icon="funnel"
              value={integer(metaTotal.leads)}
              sub={`${metaTotal.leads > 0 ? `CPL promedio ${money(metaTotal.spend / metaTotal.leads)} · ` : ""}${metaClients.length} cliente${metaClients.length === 1 ? "" : "s"}`}
            />
          ) : (
            <Kpi
              label="Sin responsable"
              icon="team"
              value={unassigned}
              sub={`de ${clients.length} cliente${clients.length === 1 ? "" : "s"}`}
            />
          )}
          <Kpi label="Miembros del equipo" icon="users" value={activeMembers.length} sub="activos en Qualita" />
        </div>

        <div className="grid g-2-1">
          <Card title="Clientes" hint={clients.length ? "Tocá un cliente para abrir su panel" : undefined}>
            {clients.length === 0 ? (
              <EmptyState label="Sin clientes">Creá el primero desde la solapa Clientes.</EmptyState>
            ) : (
              <div className="table-wrap">
                <table className="ctable">
                  <thead>
                    <tr>
                      <th>Cliente</th>
                      {adClients.length > 0 && <th>Inversión, {META_DAYS} días</th>}
                      <th>Estado</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {clients.map((c) => {
                      const meta = spendByClient.get(c.id)?.spend ?? 0;
                      const gads = gadsByClient.get(c.id) ?? 0;
                      return (
                        <tr key={c.id} className="link-row">
                          <td>
                            <Link href={`/clientes/${c.slug}`} className="cl-cell">
                              <ClientAvatar client={c} />
                              <div>
                                <b>{c.name}</b>
                                <span>{c.sector || "Sin rubro"}</span>
                              </div>
                            </Link>
                          </td>
                          {adClients.length > 0 && (
                            <td className="num">
                              {c.conn.meta || c.conn.google_ads ? (
                                <span
                                  title={[c.conn.meta && `Meta ${money(meta)}`, c.conn.google_ads && `Google Ads ${money(gads)}`]
                                    .filter(Boolean)
                                    .join(" · ")}
                                >
                                  {money(meta + gads)}
                                </span>
                              ) : (
                                <span className="muted">—</span>
                              )}
                            </td>
                          )}
                          <td>
                            <div className="chips">
                              <Pill variant={statusMeta(c.status).pill}>{statusMeta(c.status).label}</Pill>
                            </div>
                          </td>
                          <td className="go">
                            <Link href={`/clientes/${c.slug}`} aria-label={`Abrir ${c.name}`}>
                              <Icon name="chevron" size={18} strokeWidth={2} />
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Carga del equipo" hint="Clientes asignados">
            {load.map(({ member, count }) => (
              <div key={member.id} className="member" style={{ marginBottom: 18 }}>
                <div className="row">
                  <b>{member.name.split(" ")[0]}</b>
                  <span>
                    {count} cliente{count === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="barwrap">
                  <i style={{ width: `${(count / maxLoad) * 100}%` }} />
                </div>
              </div>
            ))}
            {unassigned > 0 && (
              <p className="hint-text">
                {unassigned} cliente{unassigned === 1 ? "" : "s"} sin responsable.
              </p>
            )}
          </Card>
        </div>
      </section>
    </>
  );
}
