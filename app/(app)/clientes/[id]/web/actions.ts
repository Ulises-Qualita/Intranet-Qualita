"use server";

import { revalidatePath } from "next/cache";
import { getAreaSession } from "@/lib/auth";
import { ClarityError, checkClarityToken, clarityErrorMessage, deleteClaritySecrets, getClaritySecrets, saveClaritySecrets } from "@/lib/clarity";
import { syncClarityClient } from "@/lib/clarity-sync";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true; error: null } | { ok: false; error: string };

// El id del proyecto de Clarity sale de la URL del dashboard
// (clarity.microsoft.com/projects/view/<id>/dashboard) y es alfanumérico.
const PROJECT_ID = /^[a-z0-9]{6,40}$/i;

// Las tablas de integraciones limitan `provider` con un CHECK. Si 'clarity' no
// está en esa lista, la fila se rechaza con 23514 y el mensaje genérico no ayuda.
const CHECK_VIOLATION = "23514";

function providerError(e: unknown) {
  return (e as { code?: string })?.code === CHECK_VIOLATION
    ? "Falta habilitar el proveedor en la base: correr docs/sql/2026-09-18-clarity-provider.sql en Supabase."
    : null;
}

export async function connectClarity(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const session = await getAreaSession("clientes");
  if (!session) return { ok: false, error: "No tenés acceso a los clientes." };

  const clientId = String(form.get("clientId") ?? "");
  const token = String(form.get("token") ?? "").trim();
  const projectId = String(form.get("projectId") ?? "").trim();

  if (!clientId) return { ok: false, error: "Falta el cliente." };
  if (!token) return { ok: false, error: "Pegá el token de exportación de Clarity." };
  if (projectId && !PROJECT_ID.test(projectId)) {
    return { ok: false, error: "El ID del proyecto no parece válido; se saca de la URL del dashboard de Clarity." };
  }

  // Se prueba contra la API antes de guardar: una integración marcada como
  // conectada que en realidad no responde es peor que no conectarla.
  try {
    await checkClarityToken(token);
  } catch (e) {
    return { ok: false, error: e instanceof ClarityError ? clarityErrorMessage(e) : "No se pudo contactar a Clarity." };
  }

  // saveClaritySecrets tira si la base rechaza la fila; sin este catch el error
  // sube por la Server Action y rompe la pantalla entera en vez de mostrarse acá.
  try {
    await saveClaritySecrets(clientId, { token, project_id: projectId || undefined });
  } catch (e) {
    console.error("[clarity] saveSecrets", e);
    return { ok: false, error: providerError(e) ?? "No se pudo guardar el token." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("intranet_client_integrations").upsert(
    {
      client_id: clientId,
      provider: "clarity",
      connected: true,
      account_ref: projectId || null,
      connected_at: new Date().toISOString(),
    },
    { onConflict: "client_id,provider" },
  );
  if (error) {
    console.error("[clarity] connect", error);
    return { ok: false, error: providerError(error) ?? "No se pudo guardar la conexión." };
  }

  // Primera foto enseguida, para no dejar la solapa vacía después de conectar.
  await syncClarityClient(clientId);
  revalidatePath("/", "layout");
  return { ok: true, error: null };
}

export async function disconnectClarity(clientId: string): Promise<ActionResult> {
  const session = await getAreaSession("clientes");
  if (!session) return { ok: false, error: "No tenés acceso a los clientes." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("intranet_client_integrations")
    .update({ connected: false, account_ref: null, connected_at: null })
    .eq("client_id", clientId)
    .eq("provider", "clarity");
  if (error) return { ok: false, error: "No se pudo desconectar." };

  await deleteClaritySecrets(clientId);
  revalidatePath("/", "layout");
  return { ok: true, error: null };
}

// Sincronizar a mano. Cada foto gasta 3 de las 10 llamadas diarias del proyecto,
// así que la pantalla lo avisa antes de que alguien lo use de más.
export async function refreshClarity(clientId: string): Promise<ActionResult> {
  const session = await getAreaSession("clientes");
  if (!session) return { ok: false, error: "No tenés acceso a los clientes." };
  if (!(await getClaritySecrets(clientId))) return { ok: false, error: "El cliente no tiene Clarity conectado." };

  const result = await syncClarityClient(clientId);
  revalidatePath("/", "layout");
  return result.ok ? { ok: true, error: null } : { ok: false, error: result.error ?? "No se pudo sincronizar." };
}
