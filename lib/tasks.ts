// Modelo de tareas, sin dependencias de server: lo usan lib/data.ts (server),
// lib/notion-map.ts y los componentes cliente de la pantalla de mapeo.

export type TaskStatus = "todo" | "doing" | "blocked" | "done";
export type TaskPriority = "alta" | "media" | "baja";

// De dónde salió la tarea: un ticket de Notion o una fila de intranet_tasks.
export type TaskSource = "notion" | "intranet";

export type Task = {
  id: string;
  client_id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_id: string | null;
  due_date: string | null;
  source: TaskSource;
  // Link a la página de Notion; null para las tareas propias.
  url: string | null;
};

export const isOpenTask = (t: Task) => t.status !== "done";
export const isLateTask = (t: Task, today: string) => isOpenTask(t) && !!t.due_date && t.due_date < today;
