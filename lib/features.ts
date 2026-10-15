// Funciones que un admin activa o desactiva para todo el equipo (en prueba).
// Solo server. Se guardan en intranet_settings, fila "features"; lo que no está
// guardado queda desactivado.
import { cache } from "react";
import { createClient } from "./supabase/server";

export const FEATURES_SETTINGS_KEY = "features";

export const FEATURES = [
  {
    key: "platformAnalysis",
    label: "Analizar plataforma",
    detail:
      "Botón en las solapas META (y GADS, cuando esté) que analiza la cuenta publicitaria con Claude y deja recomendaciones para tildar. Solo lo ve el equipo con el área META.",
  },
] as const;

export type FeatureKey = (typeof FEATURES)[number]["key"];
export type Features = Record<FeatureKey, boolean>;

export const isFeatureKey = (v: unknown): v is FeatureKey => FEATURES.some((f) => f.key === v);

// Se lee con la sesión del usuario: la RLS de intranet_settings deja leer a
// cualquier miembro activo y escribir solo al admin.
export const getFeatures = cache(async (): Promise<Features> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("intranet_settings")
    .select("value")
    .eq("key", FEATURES_SETTINGS_KEY)
    .maybeSingle<{ value: Record<string, unknown> }>();
  // Sin fila, sin tabla o sin permisos: todo desactivado.
  return Object.fromEntries(FEATURES.map(({ key }) => [key, data?.value?.[key] === true])) as Features;
});

export const featureEnabled = async (key: FeatureKey) => (await getFeatures())[key];
