import { OnlineCount, OnlineDot, OnlineStatus } from "@/components/presence";
import { Pill } from "@/components/ui";
import { UserAvatar } from "@/components/user-avatar";
import { getAllClients, getTasks, getTeam, isLateTask, isOpenTask } from "@/lib/data";
import { todayISO } from "@/lib/format";
import { SHOW_TASKS } from "@/lib/tasks";
import { TeamClients } from "./team-clients";

// Orden por importancia del puesto (texto libre de Administración): founders y
// dirección general primero, después directores, después responsables y managers,
// y el resto; dentro de cada grupo, por nombre. Sin puesto, al final, y los que
// no tienen acceso, después de todos.
const JOB_RANKS = [/founder|fundador|socio|ceo|due[ñn]o/i, /director|head|gerente|c[otmf]o/i, /manager|responsable|l[íi]der|lead|jefe|coordinador/i];
const jobRank = (job: string | null) => {
  if (!job) return JOB_RANKS.length + 1;
  const at = JOB_RANKS.findIndex((re) => re.test(job));
  return at < 0 ? JOB_RANKS.length : at;
};

// El equipo del estudio: una tarjeta por persona con su puesto, si está en línea,
// su rol y los clientes que tiene asignados. Es el contenido de la solapa Equipo
// del panel interno de Qualita (pedido del usuario: la pantalla Equipo pasó ahí)
// y de /equipo cuando ese panel no existe o quien entra no lo ve. Quien lo llama
// ya validó el área "equipo". `count`: muestra cuántos hay en línea arriba de la
// grilla (en /equipo va en el Topbar).
export async function StudioTeam({ count = false }: { count?: boolean }) {
  // Con las tareas ocultas no se consulta Notion.
  const [members, clients, tasks] = await Promise.all([getTeam(), getAllClients(), SHOW_TASKS ? getTasks() : []]);
  const team = [...members].sort(
    (a, b) => Number(b.active) - Number(a.active) || jobRank(a.jobTitle) - jobRank(b.jobTitle) || a.name.localeCompare(b.name, "es"),
  );
  const openTasks = tasks.filter(isOpenTask);
  const today = todayISO();

  return (
    <section className="view">
      {count && (
        <div className="view-actions">
          <OnlineCount />
        </div>
      )}
      <div className="grid g3 team-grid">
        {team.map((m) => {
          const assigned = clients.filter((c) => c.active && !c.internal && c.assigneeIds.includes(m.id));
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
                  {m.jobTitle && <span className="team-job">{m.jobTitle}</span>}
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
                <TeamClients
                  clients={assigned.map(({ id, slug, name, initials, logoUrl }) => ({ id, slug, name, initials, logoUrl }))}
                />
              ) : (
                <p className="team-empty">Sin clientes asignados</p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
