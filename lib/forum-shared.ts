// Modelo del foro sin dependencias de server: lo usan las pantallas de cliente
// (el formulario y el hilo), las Server Actions y lib/forum.ts.

export const FORUM_KINDS = [
  { value: "error", label: "Error", hint: "Algo que no anda como debería." },
  { value: "mejora", label: "Mejora", hint: "Algo que se podría hacer mejor." },
  { value: "pregunta", label: "Pregunta", hint: "Una duda sobre cómo usar la intranet." },
] as const;

export const FORUM_STATUSES = [
  { value: "abierto", label: "Abierto", pill: "onboarding" },
  { value: "en_curso", label: "En curso", pill: "neg" },
  { value: "resuelto", label: "Resuelto", pill: "al-dia" },
  { value: "descartado", label: "Descartado", pill: "pausado" },
] as const;

export type ForumKind = (typeof FORUM_KINDS)[number]["value"];
export type ForumStatus = (typeof FORUM_STATUSES)[number]["value"];

export const isForumKind = (v: unknown): v is ForumKind => FORUM_KINDS.some((k) => k.value === v);
export const isForumStatus = (v: unknown): v is ForumStatus => FORUM_STATUSES.some((s) => s.value === v);

export const kindLabel = (v: string) => FORUM_KINDS.find((k) => k.value === v)?.label ?? v;
export const statusMeta = (v: string) => FORUM_STATUSES.find((s) => s.value === v) ?? FORUM_STATUSES[0];

// Solo lo que la vista necesita del autor. getTeam() trae rol, áreas y email, y el
// foro lo ve cualquiera del equipo: no hay motivo para pasar todo eso al front.
export type Author = { id: string; name: string; avatarUrl: string | null };

export type ForumPost = {
  id: string;
  kind: ForumKind;
  title: string;
  body: string;
  status: ForumStatus;
  // Fijado arriba de todo por un admin, para lo que el equipo tiene que ver sí o sí.
  pinned: boolean;
  created_at: string;
  updated_at: string;
  author: Author | null;
  respuestas: number;
};

export type ForumComment = {
  id: string;
  body: string;
  created_at: string;
  author: Author | null;
};

// El foro entra en una sola pantalla: cada mensaje viaja con sus respuestas y el
// desplegable no tiene que pedir nada al abrirse.
export type ForumThread = ForumPost & { comments: ForumComment[] };
