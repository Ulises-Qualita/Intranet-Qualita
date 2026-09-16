import { Topbar } from "@/components/topbar";
import { NoAccess, Pill } from "@/components/ui";
import { UserAvatar } from "@/components/user-avatar";
import { getAreaSession } from "@/lib/auth";
import { getAllClients, getTasks, getTeam, isOpenTask } from "@/lib/data";

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

  const [team, clients, tasks] = await Promise.all([getTeam(), getAllClients(), getTasks()]);
  const openTasks = tasks.filter(isOpenTask);

  return (
    <>
      <Topbar crumb="Qualita" title="Equipo" />
      <section className="view">
        <div className="grid g3">
          {team.map((m) => {
            const name = m.name;
            const assigned = clients.filter((c) => c.active && c.assigneeIds.includes(m.id));
            const taskCount = openTasks.filter((t) => t.assignee_id === m.id).length;
            return (
              <div key={m.id} className="card member">
                <div className="head">
                  <UserAvatar className="fav" name={name} avatarUrl={m.avatarUrl} />
                  <div>
                    <b>{name}</b>
                    <span>{m.email}</span>
                  </div>
                </div>
                <div className="row">
                  <span>Rol</span>
                  {m.role === "admin" ? <Pill variant="admin">Admin</Pill> : <Pill variant="pausado">Miembro</Pill>}
                </div>
                <div className="row">
                  <span>Estado</span>
                  {m.active ? <Pill variant="al-dia">Activo</Pill> : <Pill variant="pausado">Inactivo</Pill>}
                </div>
                <div className="row">
                  <span>Tareas abiertas</span>
                  <b>{taskCount}</b>
                </div>
                <div>
                  <div className="row" style={{ marginBottom: 8 }}>
                    <span>Clientes asignados</span>
                    <b>{assigned.length}</b>
                  </div>
                  {assigned.length > 0 ? (
                    <div className="tags">
                      {assigned.map((c) => (
                        <span key={c.id} className="tag">
                          {c.name}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="muted" style={{ fontSize: 12.5 }}>
                      Sin clientes asignados
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
