import Link from "next/link";
import { ClientAvatar } from "@/components/client-avatar";
import { Icon } from "@/components/icons";
import { Topbar } from "@/components/topbar";
import { Card, EmptyState, Kpi, NoAccess, Pill } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { canAccess } from "@/lib/auth-shared";
import { statusMeta } from "@/lib/client-status";
import { getClients, getMetaSpendByClient, getTeam } from "@/lib/data";
import { UserAvatar } from "@/components/user-avatar";
import { greeting, longToday, money } from "@/lib/format";

// Período del gasto en Meta que muestra la tabla de clientes.
const META_DAYS = 30;

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

  // El gasto en Meta de la tabla sale de las métricas sincronizadas: solo para
  // quien puede ver META y de los clientes que lo tienen conectado.
  const [clients, team] = await Promise.all([getClients(), getTeam()]);
  const seesMeta = canAccess(session.profile, "meta");
  const metaClients = seesMeta ? clients.filter((c) => c.conn.meta) : [];
  const spendByClient = await getMetaSpendByClient(metaClients.map((c) => c.id), META_DAYS);

  const countBy = (status: string) => clients.filter((c) => c.status === status).length;
  const activeMembers = team.filter((m) => m.active);
  const integrations = clients.reduce((t, c) => t + Object.values(c.conn).filter(Boolean).length, 0);
  const connectedClients = clients.filter((c) => Object.values(c.conn).some(Boolean)).length;

  // El saludo es personal: solo lo que tiene a cargo quien está mirando. Los KPIs
  // de abajo son del estudio, por eso el texto dice "tenés".
  const mine = clients.filter((c) => c.assigneeIds.includes(session.user.id)).length;

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
          <UserAvatar className="welcome-av" name={session.user.name} avatarUrl={session.user.avatarUrl} />
          <div className="welcome-txt">
            <h2>
              {greeting()}, <span className="welcome-name">{session.user.name.split(" ")[0]}</span>
            </h2>
            <p>
              <span className="welcome-date">{longToday()}</span>
              {" · "}
              {mine === 0
                ? "No tenés clientes a cargo."
                : `Tenés ${mine} cliente${mine === 1 ? "" : "s"} a cargo.`}
            </p>
          </div>
        </div>

        <div className="grid g4 mb-4">
          <Kpi label="Clientes" icon="briefcase" value={countBy("cliente")} sub={`de ${clients.length} en total`} hero />
          <Kpi label="En onboarding" icon="target" value={countBy("onboarding")} sub={`${countBy("lead")} lead${countBy("lead") === 1 ? "" : "s"} en seguimiento`} />
          <Kpi
            label="Integraciones conectadas"
            icon="bolt"
            value={integrations}
            sub={`en ${connectedClients} de ${clients.length} cliente${clients.length === 1 ? "" : "s"}`}
          />
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
                      {metaClients.length > 0 && <th>Meta, {META_DAYS} días</th>}
                      <th>Estado</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {clients.map((c) => {
                      const spend = spendByClient.get(c.id)?.spend ?? 0;
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
                          {metaClients.length > 0 && (
                            <td className="num">{c.conn.meta ? money(spend) : <span className="muted">—</span>}</td>
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
