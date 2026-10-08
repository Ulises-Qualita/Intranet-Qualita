// Hitos de un cliente (solapa Hitos). Modelo compartido entre server y cliente,
// sin imports de server. Tabla: intranet_client_milestones
// (docs/sql/2026-10-08-hitos.sql).

export const MILESTONE_KINDS = [
  { value: "inicio", label: "Inicio" },
  { value: "hito", label: "Hito" },
  { value: "entrega", label: "Entrega" },
  { value: "lanzamiento", label: "Lanzamiento" },
] as const;

export type MilestoneKind = (typeof MILESTONE_KINDS)[number]["value"];

export const isMilestoneKind = (value: unknown): value is MilestoneKind => MILESTONE_KINDS.some((k) => k.value === value);

export const kindLabel = (kind: MilestoneKind) => MILESTONE_KINDS.find((k) => k.value === kind)!.label;

export type Milestone = {
  id: string;
  kind: MilestoneKind;
  title: string;
  description: string | null;
  // YYYY-MM-DD.
  date: string;
};

export type MilestoneInput = Omit<Milestone, "id">;

export const MILESTONE_MAX = { title: 120, description: 1000 };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Lo que llega del formulario, validado. Devuelve el texto del error si no sirve.
export function parseMilestone(raw: Partial<Record<keyof MilestoneInput, unknown>>): MilestoneInput | string {
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const description = typeof raw.description === "string" ? raw.description.trim() : "";
  const date = typeof raw.date === "string" ? raw.date : "";

  if (!title) return "Poné un título.";
  if (title.length > MILESTONE_MAX.title) return `El título no puede pasar de ${MILESTONE_MAX.title} caracteres.`;
  if (description.length > MILESTONE_MAX.description)
    return `La descripción no puede pasar de ${MILESTONE_MAX.description} caracteres.`;
  if (!ISO_DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return "Elegí una fecha válida.";
  if (!isMilestoneKind(raw.kind)) return "Elegí el tipo de hito.";

  return { kind: raw.kind, title, description: description || null, date };
}
