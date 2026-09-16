"use server";

import { revalidatePath } from "next/cache";
import { getAreaSession } from "@/lib/auth";
import { isClientStatus } from "@/lib/client-status";
import { isIntegration } from "@/lib/integrations";
import { LOGO_MAX_BYTES, LOGO_TYPES, LOGOS_BUCKET } from "@/lib/logos";
import { deleteMetaSecrets, getAdAccount, getMetaSecrets, saveMetaSecrets } from "@/lib/meta";
import { createAdminClient, createClient } from "@/lib/supabase/server";

export type FormState = { ok: boolean; error: string | null };

const NO_ACCESS: FormState = { ok: false, error: "No tenés acceso para gestionar clientes." };

const slugify = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

type ClientFields = { name: string; sector: string | null; website: string | null };

function readClientFields(formData: FormData): ClientFields | string {
  const name = String(formData.get("name") ?? "").trim();
  const sector = String(formData.get("sector") ?? "").trim();
  const website = String(formData.get("website") ?? "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");

  if (name.length < 2) return "Ingresá el nombre del cliente.";
  if (name.length > 120) return "El nombre es demasiado largo.";
  if (sector.length > 160) return "El rubro es demasiado largo.";
  if (website && !/^[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$/i.test(website)) return "La web no parece válida (ej.: marca.com).";

  return { name, sector: sector || null, website: website || null };
}

const dbError = (code: string | undefined, fallback: string) =>
  code === "42501" ? "No tenés permisos para esta acción." : fallback;

export type CreateClientResult = { ok: true; clientId: string; slug: string } | { ok: false; error: string };

export async function addClient(formData: FormData): Promise<CreateClientResult> {
  if (!(await getAreaSession("clientes"))) return { ok: false, error: NO_ACCESS.error! };

  const fields = readClientFields(formData);
  if (typeof fields === "string") return { ok: false, error: fields };

  const status = formData.get("status");
  if (!isClientStatus(status)) return { ok: false, error: "Elegí un estado válido." };

  // Sesión del usuario: la RLS de intranet_clients tiene la última palabra.
  const supabase = await createClient();
  const base = slugify(fields.name) || "cliente";
  const { data: taken } = await supabase.from("intranet_clients").select("slug").like("slug", `${base}%`);
  const used = new Set((taken ?? []).map((r) => r.slug));
  let slug = base;
  for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;

  const { data, error } = await supabase
    .from("intranet_clients")
    .insert({ ...fields, slug, status })
    .select("id, slug")
    .single();
  if (error || !data) return { ok: false, error: dbError(error?.code, "No se pudo crear el cliente.") };

  revalidatePath("/", "layout");
  return { ok: true, clientId: data.id, slug: data.slug };
}

export async function updateClient(clientId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getAreaSession("clientes"))) return NO_ACCESS;

  const fields = readClientFields(formData);
  if (typeof fields === "string") return { ok: false, error: fields };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("intranet_clients")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", clientId)
    .select("id");

  if (error || !data?.length) return { ok: false, error: dbError(error?.code, "No se pudieron guardar los cambios.") };

  revalidatePath("/", "layout");
  return { ok: true, error: null };
}

export async function setClientStatus(clientId: string, status: string): Promise<FormState> {
  if (!(await getAreaSession("clientes"))) return NO_ACCESS;
  if (!isClientStatus(status)) return { ok: false, error: "Estado inválido." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("intranet_clients")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", clientId)
    .select("id");

  if (error || !data?.length) return { ok: false, error: dbError(error?.code, "No se pudo cambiar el estado.") };

  revalidatePath("/", "layout");
  return { ok: true, error: null };
}

export async function setClientAssignee(clientId: string, userId: string, assigned: boolean): Promise<FormState> {
  if (!(await getAreaSession("clientes"))) return NO_ACCESS;

  const supabase = await createClient();
  const { error } = assigned
    ? await supabase
        .from("intranet_client_assignments")
        .upsert({ client_id: clientId, user_id: userId }, { onConflict: "client_id,user_id", ignoreDuplicates: true })
    : await supabase.from("intranet_client_assignments").delete().eq("client_id", clientId).eq("user_id", userId);

  if (error) return { ok: false, error: dbError(error.code, "No se pudo actualizar el responsable.") };

  revalidatePath("/", "layout");
  return { ok: true, error: null };
}

// El archivo va directo del navegador a Storage con una URL firmada, así no pasa
// por el límite de body de las Server Actions. Acá solo se valida y se firma.
export async function createLogoUpload(
  clientId: string,
  file: { type: string; size: number },
): Promise<{ ok: true; path: string; token: string } | { ok: false; error: string }> {
  if (!(await getAreaSession("clientes"))) return { ok: false, error: NO_ACCESS.error! };
  if (!LOGO_TYPES.includes(file.type)) return { ok: false, error: "Subí un PNG, JPG o WebP." };
  if (file.size > LOGO_MAX_BYTES) return { ok: false, error: "El logo no puede pesar más de 2 MB." };

  // Confirmar que el cliente existe y es visible para el usuario.
  const supabase = await createClient();
  const { data: client } = await supabase.from("intranet_clients").select("id").eq("id", clientId).maybeSingle();
  if (!client) return { ok: false, error: "Cliente no encontrado." };

  const { data, error } = await createAdminClient()
    .storage.from(LOGOS_BUCKET)
    .createSignedUploadUrl(clientId, { upsert: true });
  if (error || !data) return { ok: false, error: "No se pudo preparar la subida." };

  return { ok: true, path: data.path, token: data.token };
}

export async function logoUploaded(): Promise<void> {
  if (!(await getAreaSession("clientes"))) return;
  revalidatePath("/", "layout");
}

export async function removeLogo(clientId: string): Promise<FormState> {
  if (!(await getAreaSession("clientes"))) return NO_ACCESS;

  const { error } = await createAdminClient().storage.from(LOGOS_BUCKET).remove([clientId]);
  if (error) return { ok: false, error: "No se pudo quitar el logo." };

  revalidatePath("/", "layout");
  return { ok: true, error: null };
}

// Tablas que cuelgan de intranet_clients, en orden de borrado.
const CLIENT_CHILD_TABLES = [
  "intranet_client_assignments",
  "intranet_client_integrations",
  "intranet_integration_secrets",
  "intranet_tasks",
  "intranet_meta_daily",
  "intranet_meta_ads",
  "intranet_crm_snapshot",
  "intranet_leads",
];

// Borrado definitivo: solo admins. Usa service_role (tras validar el rol) porque
// intranet_integration_secrets no es visible con la sesión del usuario.
export async function deleteClient(clientId: string, confirmation: string): Promise<FormState> {
  const session = await getAreaSession("clientes");
  if (session?.profile?.role !== "admin") {
    return { ok: false, error: "Solo un administrador puede borrar clientes." };
  }

  const admin = createAdminClient();

  // El texto de confirmación se valida también acá: el botón deshabilitado no alcanza.
  const { data: client } = await admin.from("intranet_clients").select("name").eq("id", clientId).maybeSingle();
  if (!client) return { ok: false, error: "No se encontró el cliente." };
  if (confirmation !== `BORRAR ${client.name}`) {
    return { ok: false, error: "El texto de confirmación no coincide." };
  }

  for (const table of CLIENT_CHILD_TABLES) {
    const { error } = await admin.from(table).delete().eq("client_id", clientId);
    if (error) return { ok: false, error: "No se pudieron borrar los datos asociados al cliente." };
  }

  const { data, error } = await admin.from("intranet_clients").delete().eq("id", clientId).select("id");
  if (error || !data?.length) return { ok: false, error: "No se pudo borrar el cliente." };

  await admin.storage.from(LOGOS_BUCKET).remove([clientId]);

  revalidatePath("/", "layout");
  return { ok: true, error: null };
}

// Conecta o desconecta una integración del cliente (intranet_client_integrations).
// Guarda la referencia de la cuenta; la sincronización de datos corre aparte.
export async function setIntegration(
  clientId: string,
  provider: string,
  change: { connected: boolean; accountRef?: string },
): Promise<FormState> {
  if (!(await getAreaSession("clientes"))) return NO_ACCESS;
  if (!isIntegration(provider)) return { ok: false, error: "Integración inválida." };
  if (provider === "meta" && change.connected) {
    return { ok: false, error: "Meta se conecta iniciando sesión con Facebook." };
  }

  const accountRef = (change.accountRef ?? "").trim();
  if (change.connected && accountRef.length < 2) return { ok: false, error: "Completá los datos de la cuenta." };
  if (accountRef.length > 200) return { ok: false, error: "La referencia de la cuenta es demasiado larga." };

  const now = new Date().toISOString();
  const result = await writeIntegration(
    clientId,
    provider,
    change.connected
      ? { connected: true, account_ref: accountRef, connected_at: now, updated_at: now }
      : { connected: false, connected_at: null, updated_at: now },
  );
  // Al desconectar Meta se descarta también el token de Facebook.
  if (result.ok && provider === "meta") await deleteMetaSecrets(clientId);
  return result;
}

// Paso final del login con Facebook: vincula la cuenta publicitaria elegida,
// verificando que el token guardado tenga acceso a ella.
export async function connectMetaAccount(clientId: string, accountId: string): Promise<FormState> {
  if (!(await getAreaSession("clientes"))) return NO_ACCESS;
  if (!/^act_d+$/.test(accountId)) return { ok: false, error: "Elegí una cuenta publicitaria." };

  const secrets = await getMetaSecrets(clientId);
  if (!secrets) return { ok: false, error: "La sesión de Facebook venció. Volvé a iniciar sesión." };

  let account;
  try {
    account = await getAdAccount(secrets.access_token, accountId);
  } catch {
    return { ok: false, error: "Tu usuario de Facebook no tiene acceso a esa cuenta publicitaria." };
  }

  const now = new Date().toISOString();
  const result = await writeIntegration(clientId, "meta", {
    connected: true,
    account_ref: account.id,
    connected_at: now,
    updated_at: now,
  });
  if (result.ok) await saveMetaSecrets(clientId, { ...secrets, account_name: account.name });
  return result;
}

async function writeIntegration(clientId: string, provider: string, values: Record<string, unknown>): Promise<FormState> {
  const supabase = await createClient();
  const { data: existing, error: readError } = await supabase
    .from("intranet_client_integrations")
    .select("id")
    .eq("client_id", clientId)
    .eq("provider", provider)
    .maybeSingle();
  if (readError) return { ok: false, error: dbError(readError.code, "No se pudo leer la integración.") };

  const { error } = existing
    ? await supabase.from("intranet_client_integrations").update(values).eq("id", existing.id)
    : await supabase.from("intranet_client_integrations").insert({ client_id: clientId, provider, ...values });

  if (error) return { ok: false, error: dbError(error.code, "No se pudo guardar la integración.") };

  revalidatePath("/", "layout");
  return { ok: true, error: null };
}
