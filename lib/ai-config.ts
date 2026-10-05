// Qué modelo y qué esfuerzo usa cada llamada a Claude. Solo server.
//
// Orden: lo elegido en /admin/gastos (fila "ai" de intranet_settings) → la env
// ANTHROPIC_MODEL → DEFAULT_MODEL. Se lee con la sesión del usuario: la RLS de
// intranet_settings deja leer a cualquier miembro activo y escribir solo al admin.
import { cache } from "react";
import { AI_TASKS, type AiChoice, type AiConfig, type AiTask, DEFAULT_MODEL, type StoredAiConfig, isAiEffort, isAiModel } from "./ai-models";
import { createClient } from "./supabase/server";

export const AI_SETTINGS_KEY = "ai";

const fallback = (): AiChoice => ({ model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL, effort: null });

// Lo guardado se vuelve a validar: un modelo que ya no está en la lista no se usa.
function clean(value: unknown): AiChoice | null {
  if (!value || typeof value !== "object") return null;
  const { model, effort } = value as Record<string, unknown>;
  if (!isAiModel(model)) return null;
  return { model, effort: isAiEffort(effort) ? effort : null };
}

export const getStoredAiConfig = cache(async (): Promise<StoredAiConfig> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("intranet_settings")
    .select("value")
    .eq("key", AI_SETTINGS_KEY)
    .maybeSingle<{ value: Record<string, unknown> }>();
  // Sin fila, sin tabla o sin permisos: se sigue con la env y el default.
  if (error || !data?.value) return {};
  const stored: StoredAiConfig = {};
  for (const { key } of AI_TASKS) {
    const choice = clean(data.value[key]);
    if (choice) stored[key] = choice;
  }
  return stored;
});

export async function getAiConfig(): Promise<AiConfig> {
  const stored = await getStoredAiConfig();
  return Object.fromEntries(AI_TASKS.map(({ key }) => [key, stored[key] ?? fallback()])) as AiConfig;
}

export async function aiChoice(task: AiTask): Promise<AiChoice> {
  return (await getStoredAiConfig())[task] ?? fallback();
}

// Para sumar a output_config: sin esfuerzo elegido no se manda y rige el del modelo.
export const effortParam = (choice: AiChoice) => (choice.effort ? { effort: choice.effort } : {});
