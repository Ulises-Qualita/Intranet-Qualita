"use server";

import { revalidatePath } from "next/cache";
import { getAreaSession } from "@/lib/auth";
import { isRecStatus, type RecStatus } from "@/lib/analysis/shared";
import { featureEnabled } from "@/lib/features";
import { createClient } from "@/lib/supabase/server";

// Marca una recomendación como hecha, descartada o de nuevo pendiente. Con la
// sesión del usuario: la RLS vuelve a validar el área META.
export async function setRecommendationStatus(
  id: string,
  status: RecStatus,
  path: string,
): Promise<{ ok: boolean; error: string | null }> {
  const session = await getAreaSession("meta");
  if (!session) return { ok: false, error: "No tenés acceso a esta sección." };
  if (!isRecStatus(status)) return { ok: false, error: "Estado inválido." };
  if (!(await featureEnabled("platformAnalysis"))) return { ok: false, error: "El análisis de plataforma está desactivado." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("intranet_platform_recommendations")
    .update(
      status === "pendiente"
        ? { status, status_by: null, status_at: null }
        : { status, status_by: session.user.id, status_at: new Date().toISOString() },
    )
    .eq("id", id)
    .select("id");
  if (error || !data?.length) return { ok: false, error: "No se pudo guardar el cambio." };

  // Solo rutas propias de la intranet.
  if (path.startsWith("/clientes/")) revalidatePath(path);
  return { ok: true, error: null };
}
