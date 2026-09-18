import { notFound } from "next/navigation";
import { Icon } from "@/components/icons";
import { Topbar } from "@/components/topbar";
import { ConnectState, NoAccess } from "@/components/ui";
import { UserAvatar } from "@/components/user-avatar";
import { getAreaSession } from "@/lib/auth";
import { getClient, getTasksResult, getTeam, isLateTask, type Task, type TaskStatus, type TeamMember } from "@/lib/data";
import { shortDate, todayISO } from "@/lib/format";
import { RefreshNotionButton } from "./refresh-button";

const COLUMNS: { status: TaskStatus; title: string; color: string }[] = [
  { status: "todo", title: "Pendientes", color: "#9457c9" },
  { status: "doing", title: "En curso", color: "#d68a00" },
  // Mismo rojo que --down, el que ya marca lo vencido: ambos piden atención.
  { status: "blocked", title: "Bloqueadas", color: "#e0554a" },
  { status: "done", title: "Completadas", color: "#12a36b" },
];

const PRIORITY_RANK = { alta: 0, media: 1, baja: 2 };

function dueLabel(task: Task, today: string) {
  if (!task.due_date) return "Sin vencimiento";
  if (task.status !== "done" && task.due_date === today) return "Vence hoy";
  return shortDate(task.due_date);
}

function TaskCard({ task, today, assignee }: { task: Task; today: string; assignee?: TeamMember }) {
  const late = isLateTask(task, today) || (task.status !== "done" && task.due_date === today);
  return (
    <div className="task">
      <span className={`prio ${task.priority}`}>{task.priority}</span>
      {/* El link va sobre el título (buen nombre accesible) y su ::after estira el
          área clickeable a toda la tarjeta. Notion es donde se editan los tickets. */}
      <p className={task.status === "done" ? "done" : undefined}>
        {task.url ? (
          <a href={task.url} target="_blank" rel="noreferrer" className="task-link">
            {task.title}
          </a>
        ) : (
          task.title
        )}
      </p>
      <div className="foot">
        <span className={`due${late ? " late" : ""}`}>
          <Icon name="clock" size={13} strokeWidth={2} />
          {dueLabel(task, today)}
        </span>
        {assignee ? (
          <span title={assignee.name}>
            <UserAvatar className="who" name={assignee.name} avatarUrl={assignee.avatarUrl} />
          </span>
        ) : (
          <span className="muted" style={{ fontSize: 12 }}>
            Sin asignar
          </span>
        )}
      </div>
    </div>
  );
}

export default async function ClienteTareasPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getAreaSession("tareas");
  if (!session) {
    return (
      <>
        <Topbar crumb="Clientes" title="Tareas" />
        <NoAccess />
      </>
    );
  }

  const c = await getClient(id);
  if (!c) notFound();

  const [{ tasks, notionError }, team] = await Promise.all([getTasksResult(), getTeam()]);
  const members = new Map(team.map((m) => [m.id, m]));
  const today = todayISO();
  const clientTasks = tasks
    .filter((t) => t.client_id === c.id)
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);

  // Sin Notion vinculado y sin tareas propias no hay nada que mostrar: se ofrece conectar.
  if (!c.conn.notion && clientTasks.length === 0) {
    return (
      <>
        <Topbar crumb={c.name} title="Tareas" />
        <section className="view">
          <ConnectState kind="notion" client={c} />
        </section>
      </>
    );
  }

  return (
    <>
      <Topbar crumb={c.name} title="Tareas" />
      <section className="view">
        {c.conn.notion && (
          <div className="view-actions">
            <span className="muted">Tickets de Notion, en modo lectura.</span>
            <RefreshNotionButton />
          </div>
        )}

        {notionError && <p className="form-error">{notionError}</p>}

        <div className="task-cols">
          {COLUMNS.map((col) => {
            const items = clientTasks.filter((t) => t.status === col.status);
            return (
              // --col tiñe el punto y el contador con el color de la columna.
              <div key={col.status} className="task-col" style={{ "--col": col.color } as React.CSSProperties}>
                <div className="task-col-h">
                  <span className="dot" />
                  <b>{col.title}</b>
                  <span className="count">{items.length}</span>
                </div>
                {items.length === 0 ? (
                  <div className="empty">Sin tareas</div>
                ) : (
                  items.map((t) => (
                    <TaskCard key={t.id} task={t} today={today} assignee={t.assignee_id ? members.get(t.assignee_id) : undefined} />
                  ))
                )}
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
