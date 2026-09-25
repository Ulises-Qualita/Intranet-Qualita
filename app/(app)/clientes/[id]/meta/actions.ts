"use server";

import { getAreaSession, getClientSession } from "@/lib/auth";
import { getClient } from "@/lib/data";
import { type AdPreview, getAdPreview, getMetaSecrets, isAuthError } from "@/lib/meta";
import { createClient } from "@/lib/supabase/server";

export type PreviewResult = { ok: true; preview: AdPreview } | { ok: false; error: string };

// Vista previa de un anuncio, pedida a Meta al abrirla (la URL que devuelve vence
// en ~24 h). La usan la tabla de META y la card de videos del CRM, tanto del
// equipo como de la cuenta del cliente (/mi-empresa).
export async function loadAdPreview(clientSlug: string, adId: string): Promise<PreviewResult> {
  const [staff, account, client] = await Promise.all([
    getAreaSession("meta"),
    getClientSession(),
    getClient(clientSlug),
  ]);
  // Equipo con META, o la cuenta activa de ESE cliente. getClient ya lee con la
  // RLS (una cuenta de cliente solo ve su empresa); el chequeo de id lo repite.
  const allowed = !!staff || (!!account?.active && !!client && account.clientId === client.id);
  if (!allowed) return { ok: false, error: "No tenés acceso a META." };
  if (!client?.conn.meta) return { ok: false, error: "El cliente no tiene Meta conectado." };

  // El anuncio tiene que ser de este cliente: sin esto, con el token de un
  // cliente se podría pedir cualquier anuncio que ese usuario de Facebook vea.
  const supabase = await createClient();
  const { data: owned } = await supabase
    .from("intranet_meta_ads")
    .select("id")
    .eq("client_id", client.id)
    .eq("ad_external_id", adId)
    .limit(1);
  if (!owned?.length) return { ok: false, error: "Anuncio no encontrado." };

  const secrets = await getMetaSecrets(client.id);
  if (!secrets) return { ok: false, error: "La sesión de Facebook venció. Hay que volver a conectar Meta." };

  try {
    const preview = await getAdPreview(secrets.access_token, adId);
    return preview ? { ok: true, preview } : { ok: false, error: "Meta no tiene vista previa para este anuncio." };
  } catch (e) {
    console.error("[meta] preview", adId, e instanceof Error ? e.message : e);
    return {
      ok: false,
      error: isAuthError(e)
        ? "La sesión de Facebook venció. Hay que volver a conectar Meta."
        : "No se pudo cargar la vista previa.",
    };
  }
}
