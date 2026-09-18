import Link from "next/link";
import { ClientAvatar } from "@/components/client-avatar";
import { Icon } from "@/components/icons";
import { Topbar } from "@/components/topbar";
import { Card, EmptyState, Kpi, NoAccess, Pill } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { statusMeta } from "@/lib/client-status";
import { getClients, getTasks, getTeam, isLateTask, isOpenTask } from "@/lib/data";
import { UserAvatar } from "@/components/user-avatar";
import { greeting, longToday, todayISO } from "@/lib/format";

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

  const [clients, team, tasks] = await Promise.all([getClients(), getTeam(), getTasks()]);
  const today = todayISO();
  const activeClientIds = new Set(clients.map((c) => c.id));
  const openTasks = tasks.filter((t) => isOpenTask(t) && activeClientIds.has(t.client_id));
  const lateTasks = openTasks.filter((t) => isLateTask(t, today));
  const countBy = (status: string) => clients.filter((c) => c.status === status).length;
  const activeMembers = team.filter((m) => m.active);

  // El saludo es personal: solo lo que tiene a cargo quien está mirando. Los KPIs
  // de abajo siguen siendo del estudio, por eso el texto dice "tenés".
  const myTasks = openTasks.filter((t) => t.assignee_id === session.user.id);
  const myLate = myTasks.filter((t) => isLateTask(t, today));

  const load = activeMembers
    .map((m) => ({ member: m, count: openTasks.filter((t) => t.assignee_id === m.id).length }))
    .sort((a, b) => b.count - a.count);
  const maxLoad = Math.max(1, ...load.map((l) => l.count));
  const unassigned = openTasks.filter((t) => !t.assignee_id).length;

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
              {myTasks.length === 0
                ? "No tenés tareas pendientes."
                : `Tenés ${myTasks.length} tarea${myTasks.length === 1 ? "" : "s"} pendiente${myTasks.length === 1 ? "" : "s"}${
                    myLate.length ? `, ${myLate.length} vencida${myLate.length === 1 ? "" : "s"}` : ""
                  }.`}
            </p>
          </div>
        </div>

        <div className="grid g4 mb-4">
          <Kpi label="Clientes" icon="briefcase" value={countBy("cliente")} sub={`de ${clients.length} en total`} hero />
          <Kpi label="En onboarding" icon="target" value={countBy("onboarding")} sub={`${countBy("lead")} lead${countBy("lead") === 1 ? "" : "s"} en seguimiento`} />
          <Kpi
            label="Tareas pendientes"
            icon="check"
            value={openTasks.length}
            sub={lateTasks.length ? `${lateTasks.length} vencida${lateTasks.length === 1 ? "" : "s"}` : "ninguna vencida"}
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
                      <th>Tareas</th>
                      <th>Estado</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {clients.map((c) => {
                      const clientOpen = openTasks.filter((t) => t.client_id === c.id);
                      const hasLate = clientOpen.some((t) => isLateTask(t, today));
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
                          <td className="num">{clientOpen.length}</td>
                          <td>
                            <div className="chips">
                              <Pill variant={statusMeta(c.status).pill}>{statusMeta(c.status).label}</Pill>
                              {hasLate && <Pill variant="atencion">Tareas vencidas</Pill>}
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

          <Card title="Carga del equipo" hint="Tareas abiertas asignadas">
            {load.map(({ member, count }) => (
              <div key={member.id} className="member" style={{ marginBottom: 18 }}>
                <div className="row">
                  <b>{member.name.split(" ")[0]}</b>
                  <span>
                    {count} tarea{count === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="barwrap">
                  <i style={{ width: `${(count / maxLoad) * 100}%` }} />
                </div>
              </div>
            ))}
            {unassigned > 0 && (
              <p className="hint-text">
                {unassigned} tarea{unassigned === 1 ? "" : "s"} abierta{unassigned === 1 ? "" : "s"} sin responsable.
              </p>
            )}
          </Card>
        </div>
      </section>
    </>
  );
}
