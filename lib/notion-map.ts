// Traducción entre los tickets de Notion y el modelo de tareas de la intranet.
// Sin I/O: se usa tanto al leer datos como en la pantalla de mapeo del admin.
import type { NotionPage, NotionProperty, RawProperty } from "./notion";
import type { TaskPriority, TaskStatus } from "./tasks";

// Qué propiedad de la DB de Tickets cumple cada rol. Guardado en
// intranet_settings['notion'] desde /admin/notion.
export type NotionProps = {
  status: string;
  priority: string;
  assignee: string;
  dueDate: string;
  project: string;
};

export type NotionConfig = {
  projectsDataSourceId: string;
  ticketsDataSourceId: string;
  props: NotionProps;
  // Nombre de la opción en Notion → columna / prioridad de la intranet.
  statusMap: Record<string, TaskStatus>;
  priorityMap: Record<string, TaskPriority>;
  // Estados que no son trabajo del equipo (en Qualita, "Reuniones"): sus tickets
  // no entran al tablero ni a los contadores. Se eligen en /admin/notion.
  hiddenStatuses: string[];
  // Portal del cliente: propiedad de tipo url en la database de Proyectos con el
  // link a la página del portal. Opcional: sin esto la solapa avisa y nada más.
  portalUrlProp: string;
};

export const EMPTY_NOTION_CONFIG: NotionConfig = {
  projectsDataSourceId: "",
  ticketsDataSourceId: "",
  props: { status: "", priority: "", assignee: "", dueDate: "", project: "" },
  statusMap: {},
  priorityMap: {},
  hiddenStatuses: [],
  portalUrlProp: "",
};

// Configurada = alcanza para leer tickets y saber a qué proyecto pertenecen.
// El resto de las propiedades son opcionales: sin ellas el ticket igual se muestra.
export const isNotionConfigured = (c: NotionConfig | null): c is NotionConfig =>
  !!c && !!c.ticketsDataSourceId && !!c.props.project;

// Para el portal alcanza con saber qué propiedad del proyecto guarda el link.
export const isPortalConfigured = (c: NotionConfig | null): c is NotionConfig =>
  !!c && !!c.projectsDataSourceId && !!c.portalUrlProp;

// Notion acepta ids con guiones o sin ellos; de una URL salen sin guiones y a
// veces con el título y un "-" adelante (…/Portal-del-cliente-<id>).
export function pageIdFromUrl(url: string): string | null {
  const match = url.match(/([0-9a-f]{32})|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return match ? match[0] : null;
}

// Notion devuelve los ids con guiones, pero si alguien los copia de una URL vienen
// sin ellos. Comparar siempre normalizado.
export const normalizeId = (id: string) => id.replace(/-/g, "").toLowerCase();

// ---------- Lectura de propiedades ----------

const optionName = (prop?: RawProperty): string | null => {
  if (!prop) return null;
  if (prop.type === "status") return prop.status?.name ?? null;
  if (prop.type === "select") return prop.select?.name ?? null;
  // Un multi-select como estado es raro pero no rompe: se toma el primero.
  if (prop.type === "multi_select") return prop.multi_select?.[0]?.name ?? null;
  if (prop.type === "formula" && prop.formula?.type === "string") return prop.formula.string ?? null;
  return null;
};

const dateStart = (prop?: RawProperty): string | null => {
  const raw = prop?.type === "formula" ? (prop.formula?.date?.start ?? null) : (prop?.date?.start ?? null);
  // Notion puede devolver fecha con hora ("2026-03-11T09:00:00-03:00"); la UI
  // (isLateTask, shortDate) trabaja con YYYY-MM-DD.
  return raw ? raw.slice(0, 10) : null;
};

const relationIds = (prop?: RawProperty): string[] => (prop?.relation ?? []).map((r) => normalizeId(r.id));

// ---------- Tipos que la UI de mapeo necesita ----------

// Propiedades candidatas para cada rol, para pre-seleccionar en la pantalla de admin.
export const PROP_ROLES: { key: keyof NotionProps; label: string; types: string[]; hints: string[] }[] = [
  { key: "project", label: "Proyecto", types: ["relation"], hints: ["proyecto", "project"] },
  { key: "status", label: "Estado", types: ["status", "select", "multi_select"], hints: ["estado", "status"] },
  { key: "priority", label: "Prioridad", types: ["status", "select", "multi_select"], hints: ["prioridad", "priority"] },
  { key: "assignee", label: "Responsable", types: ["people"], hints: ["responsable", "asignado", "assignee", "owner"] },
  { key: "dueDate", label: "Vencimiento", types: ["date"], hints: ["vencimiento", "fecha", "due", "deadline", "entrega"] },
];

// Adivina qué propiedad va en cada rol: primero por nombre, después por tipo.
export function guessProps(properties: NotionProperty[]): NotionProps {
  const guessed = { ...EMPTY_NOTION_CONFIG.props };
  for (const role of PROP_ROLES) {
    const candidates = properties.filter((p) => role.types.includes(p.type));
    const byName = candidates.find((p) => role.hints.some((h) => p.name.toLowerCase().includes(h)));
    guessed[role.key] = (byName ?? candidates[0])?.name ?? "";
  }
  return guessed;
}

// Opciones de una propiedad de tipo status/select, para mapearlas una por una.
export function propertyOptions(properties: NotionProperty[], name: string): string[] {
  const prop = properties.find((p) => p.name === name);
  return (prop?.options ?? []).map((o) => o.name);
}

// Notion agrupa los "status" en To-do / In progress / Complete: buena base para
// pre-cargar el mapeo sin que el usuario tenga que elegir opción por opción.
const GROUP_STATUS: Record<string, TaskStatus> = { "to-do": "todo", "in progress": "doing", complete: "done" };

// "Bloqueado" vive dentro del grupo "In progress" de Notion, así que el nombre de
// la opción tiene que ganarle al grupo o todo lo bloqueado cae en "En curso".
const BLOCKED = /(bloquead|blocked|trabad|frenad|pausad|espera|hold|stuck|impedi)/;

export function guessStatusMap(properties: NotionProperty[], name: string): Record<string, TaskStatus> {
  const prop = properties.find((p) => p.name === name);
  const map: Record<string, TaskStatus> = {};
  const byId = new Map((prop?.options ?? []).map((o) => [o.id, o.name]));

  for (const group of prop?.groups ?? []) {
    const status = GROUP_STATUS[group.name.toLowerCase()];
    if (!status) continue;
    for (const id of group.option_ids) {
      const optName = byId.get(id);
      if (optName && !BLOCKED.test(optName.toLowerCase())) map[optName] = status;
    }
  }

  // Sin grupos (p. ej. un select) o bloqueadas: heurística por nombre de la opción.
  for (const opt of prop?.options ?? []) {
    if (map[opt.name]) continue;
    const n = opt.name.toLowerCase();
    if (BLOCKED.test(n)) map[opt.name] = "blocked";
    else if (/(hecho|complet|listo|done|finaliz|cerrad|aprobad)/.test(n)) map[opt.name] = "done";
    else if (/(curso|proceso|progress|haciendo|doing|revis)/.test(n)) map[opt.name] = "doing";
    else map[opt.name] = "todo";
  }
  return map;
}

export function guessPriorityMap(properties: NotionProperty[], name: string): Record<string, TaskPriority> {
  const prop = properties.find((p) => p.name === name);
  const map: Record<string, TaskPriority> = {};
  for (const opt of prop?.options ?? []) {
    const n = opt.name.toLowerCase();
    if (/(alta|high|urgent|urgente|p0|p1|crít|crit)/.test(n)) map[opt.name] = "alta";
    else if (/(baja|low|p3|p4)/.test(n)) map[opt.name] = "baja";
    else map[opt.name] = "media";
  }
  return map;
}

// ---------- Ticket de Notion → tarea ----------

export type NotionTicket = {
  id: string;
  title: string;
  url: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  projectIds: string[];
  // Se resuelven contra intranet_profiles en lib/data.ts.
  peopleEmails: string[];
  peopleNames: string[];
  // Estado marcado como "No mostrar": getTickets() lo descarta.
  hidden: boolean;
};

export function toTicket(page: NotionPage, config: NotionConfig): NotionTicket {
  const props = page.properties;

  let title = "Sin título";
  for (const prop of Object.values(props)) {
    if (prop.type === "title") {
      const text = (prop.title ?? []).map((t) => t.plain_text).join("").trim();
      if (text) title = text;
      break;
    }
  }

  const statusName = optionName(props[config.props.status]);
  const priorityName = optionName(props[config.props.priority]);
  const people = props[config.props.assignee]?.people ?? [];

  return {
    id: page.id,
    title,
    url: page.url,
    // Una opción que todavía no se mapeó cae en "Pendientes": si mañana agregan un
    // estado nuevo en Notion, el ticket se ve igual en vez de desaparecer callado.
    status: (statusName && config.statusMap[statusName]) || "todo",
    priority: (priorityName && config.priorityMap[priorityName]) || "media",
    dueDate: dateStart(props[config.props.dueDate]),
    projectIds: relationIds(props[config.props.project]),
    peopleEmails: people.map((p) => p.person?.email).filter((e): e is string => !!e),
    peopleNames: people.map((p) => p.name).filter((n): n is string => !!n),
    hidden: !!statusName && (config.hiddenStatuses ?? []).includes(statusName),
  };
}
