// Modelo y esfuerzo de Claude para cada uso de la intranet. Client-safe: lo
// usan el panel de /admin/gastos y lib/ai-config.ts (que lee lo guardado).

// Solo modelos con thinking adaptativo y effort: todas las llamadas los usan.
// Haiku 4.5 queda afuera porque pide budget_tokens y no acepta effort.
export const AI_MODELS = [
  { id: "claude-opus-5-5", label: "Opus 5.5", price: "US$ 4 / 20" },
  { id: "claude-opus-5", label: "Opus 5", price: "US$ 5 / 25" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", price: "US$ 2 / 10" },
] as const;

export type AiModel = (typeof AI_MODELS)[number]["id"];

// Sin "max": en un chat o un reporte no compensa lo que cuesta.
export const AI_EFFORTS = [
  { id: "low", label: "Bajo" },
  { id: "medium", label: "Medio" },
  { id: "high", label: "Alto" },
  { id: "xhigh", label: "Muy alto" },
] as const;

export type AiEffort = (typeof AI_EFFORTS)[number]["id"];

export const AI_TASKS = [
  { key: "agente", label: "Agente Q", detail: "El chat del equipo." },
  { key: "reporte", label: "Reportes", detail: "Los textos de un reporte nuevo y los cambios pedidos por chat." },
] as const;

export type AiTask = (typeof AI_TASKS)[number]["key"];

// effort null = el que trae el modelo por defecto (medium en Opus 5.5, high en el resto).
export type AiChoice = { model: string; effort: AiEffort | null };

export type AiConfig = Record<AiTask, AiChoice>;

// Lo que se guarda en intranet_settings: solo las tareas que el admin tocó.
export type StoredAiConfig = Partial<Record<AiTask, AiChoice>>;

export const DEFAULT_MODEL: AiModel = "claude-opus-5-5";

export const isAiModel = (v: unknown): v is AiModel => AI_MODELS.some((m) => m.id === v);
export const isAiEffort = (v: unknown): v is AiEffort => AI_EFFORTS.some((e) => e.id === v);
