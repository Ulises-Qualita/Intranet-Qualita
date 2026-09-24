"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { getAreaSession } from "@/lib/auth";
import { isClientStatus } from "@/lib/client-status";
import { crmProviderLabel, isCrmProvider } from "@/lib/crm-shared";
import { deleteCrmSecrets, getCrmSecrets, saveCrmSecrets, syncCrmClient } from "@/lib/crm-sync";
import { CONNECT_PAGES, isIntegration } from "@/lib/integrations";
import { LOGO_MAX_BYTES, LOGO_TYPES, LOGOS_BUCKET } from "@/lib/logos";
import { deleteMetaSecrets, getAdAccount, getMetaSecrets, saveMetaSecrets } from "@/lib/meta";
import { NOTION_PORTAL_TAG, NOTION_TICKETS_TAG, getPageRef, notionErrorMessage } from "@/lib/notion";
import { KommoError, kommoAccount, normalizeKommoUrl } from "@/lib/kommo";
import { normalizeOdooUrl, odooLogin } from "@/lib/odoo";
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

const dbError = (code: string | undefined, fallback: string) => {
  if (code === "42501") return "No tenés permisos para esta acción.";
  // CHECK violado: casi siempre es un proveedor nuevo que la base todavía no acepta.
  if (code === "23514") return "La base rechazó el valor. Puede faltar correr la migración de docs/sql/.";
  return fallback;
};

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
  // Estos tienen pantalla propia: no se conectan escribiendo la referencia a mano.
  if (change.connected && provider in CONNECT_PAGES) {
    return { ok: false, error: CONNECT_PAGES[provider as keyof typeof CONNECT_PAGES].manualError };
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
  // Ídem con las credenciales del CRM.
  if (result.ok && provider === "crm" && !change.connected) await deleteCrmSecrets(clientId);
  // Al desconectar Notion cambian los tickets visibles: se descarta el cache.
  if (result.ok && provider === "notion") revalidateTag(NOTION_TICKETS_TAG, { expire: 0 });
  return result;
}

// Paso final del login con Facebook: vincula la cuenta publicitaria elegida,
// verificando que el token guardado tenga acceso a ella.
export async function connectMetaAccount(clientId: string, accountId: string): Promise<FormState> {
  if (!(await getAreaSession("clientes"))) return NO_ACCESS;
  if (!/^act_\d+$/.test(accountId)) return { ok: false, error: "Elegí una cuenta publicitaria." };

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

// Vincula el cliente con una página de la database de Proyectos de Notion.
// Se valida contra Notion que la página exista antes de guardarla.
export async function connectNotionProject(clientId: string, pageId: string): Promise<FormState> {
  if (!(await getAreaSession("clientes"))) return NO_ACCESS;
  if (!pageId) return { ok: false, error: "Elegí un proyecto de Notion." };

  let project;
  try {
    project = await getPageRef(pageId);
  } catch (e) {
    console.error("[notion] connectNotionProject", e);
    return { ok: false, error: notionErrorMessage(e) };
  }

  const now = new Date().toISOString();
  const result = await writeIntegration(clientId, "notion", {
    connected: true,
    account_ref: project.id,
    connected_at: now,
    updated_at: now,
  });
  // El cliente nuevo cambia qué tickets se muestran: hay que releer Notion.
  if (result.ok) revalidateTag(NOTION_TICKETS_TAG, { expire: 0 });
  return result;
}

// Fuerza una lectura fresca de Notion sin esperar a que venza el cache.
export async function refreshNotion(): Promise<FormState> {
  if (!(await getAreaSession("tareas"))) return { ok: false, error: "No tenés acceso a las tareas." };
  revalidateTag(NOTION_TICKETS_TAG, { expire: 0 });
  revalidatePath("/", "layout");
  return { ok: true, error: null };
}

// Conecta el CRM del cliente. Cada cliente puede usar uno distinto: el proveedor
// y sus credenciales se guardan del lado server, nunca vuelven al navegador.
// Antes de guardar se prueba la conexión contra el CRM.
export async function connectCrm(clientId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await getAreaSession("clientes"))) return NO_ACCESS;

  const provider = String(formData.get("provider") ?? "");
  if (!isCrmProvider(provider)) return { ok: false, error: "Elegí un CRM de la lista." };

  if (provider === "kommo") return connectKommo(clientId, formData);

  const db = String(formData.get("db") ?? "").trim();
  const username = String(formData.get("username") ?? "").trim();
  const apiKey = String(formData.get("apiKey") ?? "").trim();
  if (!db || !username || !apiKey) return { ok: false, error: "Completá base de datos, usuario y clave de API." };

  let credentials;
  try {
    credentials = { url: normalizeOdooUrl(String(formData.get("url") ?? "")), db, username, apiKey };
  } catch {
    return { ok: false, error: "La dirección de Odoo no es válida (ej.: https://empresa.odoo.com)." };
  }

  // Probar antes de guardar: así el error se ve acá y no en el próximo sync.
  try {
    await odooLogin(credentials);
  } catch (e) {
    console.error("[crm] connectCrm", e);
    return { ok: false, error: e instanceof Error ? e.message : "No se pudo conectar con Odoo." };
  }

  await saveCrmSecrets(clientId, { provider, odoo: credentials });

  const now = new Date().toISOString();
  const result = await writeIntegration(clientId, "crm", {
    connected: true,
    account_ref: `${crmProviderLabel(provider)} · ${db}`,
    connected_at: now,
    updated_at: now,
  });
  // Primera lectura del CRM para que la vista no arranque vacía.
  if (result.ok) await syncCrmClient(clientId);
  return result;
}

// Kommo: cuenta + token de larga duración de una integración privada.
async function connectKommo(clientId: string, formData: FormData): Promise<FormState> {
  const token = String(formData.get("token") ?? "").trim();
  if (!token) return { ok: false, error: "Pegá el token de larga duración de Kommo." };

  let credentials;
  try {
    credentials = { url: normalizeKommoUrl(String(formData.get("account") ?? "")), token };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "La cuenta de Kommo no es válida." };
  }

  // Probar antes de guardar: así el error se ve acá y no en el próximo sync.
  let account;
  try {
    account = await kommoAccount(credentials);
  } catch (e) {
    console.error("[crm] connectKommo", e);
    return { ok: false, error: e instanceof KommoError ? e.message : "No se pudo conectar con Kommo." };
  }

  await saveCrmSecrets(clientId, { provider: "kommo", kommo: credentials });

  const now = new Date().toISOString();
  const result = await writeIntegration(clientId, "crm", {
    connected: true,
    account_ref: `Kommo · ${account}`,
    connected_at: now,
    updated_at: now,
  });
  if (!result.ok) return result;

  // Primera lectura del CRM. Si falla, la conexión queda guardada y el motivo se
  // ve en la pantalla (sync_error), pero conviene decirlo acá también.
  const sync = await syncCrmClient(clientId);
  return sync.ok ? result : { ok: false, error: `Conectado, pero no se pudieron leer los leads: ${sync.error}` };
}

// Etapas del CRM que cuentan como venta ganada. El pipeline de cada cliente sigue
// después del cierre (producción, entrega), así que no alcanza con lo que el CRM
// marca como ganado: lo define el equipo por cliente.
export async function setCrmWonStages(clientId: string, stages: string[]): Promise<FormState> {
  if (!(await getAreaSession("clientes"))) return NO_ACCESS;

  const secrets = await getCrmSecrets(clientId);
  if (!secrets) return { ok: false, error: "El cliente no tiene un CRM conectado." };

  // Solo etapas que el CRM informó: evita guardar nombres que no existen.
  const known = new Set(secrets.stage_order ?? []);
  await saveCrmSecrets(clientId, { ...secrets, won_stages: stages.filter((s) => known.has(s)) });

  // Cambia el estado de cada oportunidad: hay que recalcularlo.
  const result = await syncCrmClient(clientId);
  if (!result.ok) return { ok: false, error: result.error ?? "No se pudo releer el CRM." };

  revalidatePath("/", "layout");
  return { ok: true, error: null };
}

// Fuerza una lectura fresca del portal del cliente.
export async function refreshPortal(): Promise<FormState> {
  if (!(await getAreaSession("clientes"))) return NO_ACCESS;
  revalidateTag(NOTION_PORTAL_TAG, { expire: 0 });
  revalidatePath("/", "layout");
  return { ok: true, error: null };
}
