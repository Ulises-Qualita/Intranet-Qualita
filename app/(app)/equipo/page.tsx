import Link from "next/link";
import { ClientAvatar } from "@/components/client-avatar";
import { OnlineCount, OnlineDot, OnlineStatus } from "@/components/presence";
import { Topbar } from "@/components/topbar";
import { NoAccess, Pill } from "@/components/ui";
import { UserAvatar } from "@/components/user-avatar";
import { getAreaSession } from "@/lib/auth";
import { getAllClients, getTasks, getTeam, isLateTask, isOpenTask } from "@/lib/data";
import { todayISO } from "@/lib/format";
import { SHOW_TASKS } from "@/lib/tasks";

export default async function EquipoPage() {
  const session = await getAreaSession("equipo");
  if (!session) {
    return (
      <>
        <Topbar crumb="Qualita" title="Equipo" />
        <NoAccess />
      </>
    );
  }

  // Con las tareas ocultas no se consulta Notion.
  const [team, clients, tasks] = await Promise.all([getTeam(), getAllClients(), SHOW_TASKS ? getTasks() : []]);
  const openTasks = tasks.filter(isOpenTask);
  const today = todayISO();

  return (
    <>
      <Topbar crumb="Qualita" title="Equipo">
        <OnlineCount />
      </Topbar>
      <section className="view">
        <div className="grid g3 team-grid">
          {team.map((m) => {
            const assigned = clients.filter((c) => c.active && c.assigneeIds.includes(m.id));
            const mine = openTasks.filter((t) => t.assignee_id === m.id);
            const late = mine.filter((t) => isLateTask(t, today)).length;
            return (
              <article key={m.id} className={`card team-card${m.active ? "" : " off"}`}>
                <header className="team-head">
                  <div className="av-wrap">
                    <UserAvatar className="team-av" name={m.name} avatarUrl={m.avatarUrl} />
                    <OnlineDot userId={m.id} />
                  </div>
                  <div className="team-id">
                    <h3>{m.name}</h3>
                    <span className="team-mail" title={m.email ?? undefined}>
                      {m.email}
                    </span>
                    {m.active ? (
                      <OnlineStatus userId={m.id} />
                    ) : (
                      <span className="muted">{m.invited ? "Invitación pendiente" : "Sin acceso a la intranet"}</span>
                    )}
                  </div>
                  {m.role === "admin" ? <Pill variant="admin">Admin</Pill> : <Pill variant="pausado">Miembro</Pill>}
                </header>

                <dl className="team-stats">
                  {SHOW_TASKS && (
                    <div>
                      <dt>Tareas abiertas</dt>
                      <dd>{mine.length}</dd>
                      {late > 0 && (
                        <span className="team-late">
                          {late} {late === 1 ? "vencida" : "vencidas"}
                        </span>
                      )}
                    </div>
                  )}
                  <div>
                    <dt>{assigned.length === 1 ? "Cliente" : "Clientes"}</dt>
                    <dd>{assigned.length}</dd>
                  </div>
                </dl>

                {assigned.length > 0 ? (
                  <ul className="team-clients">
                    {assigned.map((c) => (
                      <li key={c.id}>
                        <Link href={`/clientes/${c.slug}`}>
                          <ClientAvatar client={c} />
                          {c.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="team-empty">Sin clientes asignados</p>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </>
  );
}
