"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { AREAS, isQualitaEmail, type AreaKey, type Role } from "@/lib/auth-shared";
import { getSession } from "@/lib/auth";
import { NOTION_SETTINGS_KEY } from "@/lib/data";
import { NOTION_PORTAL_TAG, NOTION_TICKETS_TAG, getDataSource, notionErrorMessage, type NotionProperty } from "@/lib/notion";
import type { NotionConfig } from "@/lib/notion-map";
import { createAdminClient, createClient } from "@/lib/supabase/server";

const AREA_KEYS = new Set<string>(AREAS.map(([k]) => k));

export type ActionResult = { ok: true; error: null } | { ok: false; error: string };

async function requireAdmin() {
  const session = await getSession();
  return session?.profile?.role === "admin" && session.profile.active ? session : null;
}

export async function updateUserAccess(
  userId: string,
  patch: { role?: Role; areas?: Record<AreaKey, boolean>; active?: boolean },
): Promise<ActionResult> {
  const session = await requireAdmin();
  if (!session) return { ok: false, error: "Solo un administrador puede cambiar accesos." };

  const isSelf = userId === session.user.id;
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (patch.role !== undefined) {
    if (patch.role !== "admin" && patch.role !== "member") return { ok: false, error: "Rol inválido." };
    if (isSelf) return { ok: false, error: "No podés cambiar tu propio rol." };
    update.role = patch.role;
  }

  if (patch.active !== undefined) {
    if (isSelf) return { ok: false, error: "No podés desactivar tu propia cuenta." };
    update.active = patch.active === true;
  }

  if (patch.areas !== undefined) {
    const entries = Object.entries(patch.areas);
    if (entries.some(([k, v]) => !AREA_KEYS.has(k) || typeof v !== "boolean")) {
      return { ok: false, error: "Áreas inválidas." };
    }
    update.areas = Object.fromEntries(entries);
  }

  // Cliente con la sesión del usuario: la RLS de intranet_profiles vuelve a exigir admin.
  const supabase = await createClient();
  const { data, error } = await supabase.from("intranet_profiles").update(update).eq("id", userId).select("id");

  if (error || !data?.length) return { ok: false, error: "No se pudo guardar el cambio." };

  revalidatePath("/", "layout");
  return { ok: true, error: null };
}

// Da de alta a alguien del equipo antes de su primer ingreso, para poder asignarle
// áreas de antemano. Crea el usuario en Auth (sin mandar mails); cuando entre con
// Google, Supabase vincula la identidad por email verificado.
export async function addMember(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  if (!(await requireAdmin())) return { ok: false, error: "Solo un administrador puede agregar miembros." };

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(email) || !isQualitaEmail(email)) {
    return { ok: false, error: "Ingresá un correo @qualita.studio válido." };
  }

  const admin = createAdminClient();

  const { data: existing } = await admin.from("intranet_profiles").select("id").eq("email", email).maybeSingle();
  if (existing) return { ok: false, error: "Ese correo ya está en la lista." };

  // Auth es compartido con el otro app: puede que la persona ya exista ahí.
  const { data: list, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listError) return { ok: false, error: "No se pudo verificar el correo." };
  let userId = list.users.find((u) => u.email?.toLowerCase() === email)?.id;

  if (!userId) {
    const { data: created, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (error || !created.user) return { ok: false, error: "No se pudo crear el usuario." };
    userId = created.user.id;
  }

  // El trigger on_auth_user_created_intranet crea el perfil; el upsert cubre usuarios
  // que ya existían en Auth sin perfil de intranet.
  const { error: profileError } = await admin
    .from("intranet_profiles")
    .upsert({ id: userId, email, role: "member", areas: {}, active: true },{ onConflict: "id", ignoreDuplicates: true });
  if (profileError) return { ok: false, error: "Se creó el usuario pero no su perfil de intranet." };

  revalidatePath("/", "layout");
  return { ok: true, error: null };
}

// ---------- Configuración de Notion (intranet_settings) ----------

// Guarda qué data sources de Notion usar y cómo se mapean sus propiedades.
// Solo admin: define lo que ve todo el equipo en Tareas.
export async function saveNotionConfig(config: NotionConfig): Promise<ActionResult> {
  if (!(await requireAdmin())) return { ok: false, error: "Solo un administrador puede configurar Notion." };

  if (!config.ticketsDataSourceId) return { ok: false, error: "Elegí la database de Tickets." };
  if (!config.projectsDataSourceId) return { ok: false, error: "Elegí la database de Proyectos." };
  if (!config.props.project) return { ok: false, error: "Elegí qué propiedad relaciona el ticket con su proyecto." };

  // Se normaliza para no guardar campos de más en el jsonb.
  const value: NotionConfig = {
    projectsDataSourceId: config.projectsDataSourceId,
    ticketsDataSourceId: config.ticketsDataSourceId,
    props: {
      status: config.props.status ?? "",
      priority: config.props.priority ?? "",
      assignee: config.props.assignee ?? "",
      dueDate: config.props.dueDate ?? "",
      project: config.props.project,
    },
    statusMap: config.statusMap ?? {},
    priorityMap: config.priorityMap ?? {},
    hiddenStatuses: config.hiddenStatuses ?? [],
    // Portal del cliente: opcional. Sin esto la solapa avisa que falta configurar
    // y el resto de la app sigue igual.
    portalUrlProp: config.portalUrlProp ?? "",
  };

  const supabase = await createClient();
  const { error } = await supabase
    .from("intranet_settings")
    .upsert({ key: NOTION_SETTINGS_KEY, value, updated_at: new Date().toISOString() });

  if (error) {
    return {
      ok: false,
      error:
        error.code === "42P01"
          ? "Falta crear la tabla intranet_settings (docs/sql/2026-09-17-intranet-settings.sql)."
          : "No se pudo guardar la configuración de Notion.",
    };
  }

  // Cambió el mapeo: lo que estaba cacheado ya no sirve.
  revalidateTag(NOTION_TICKETS_TAG, { expire: 0 });
  revalidateTag(NOTION_PORTAL_TAG, { expire: 0 });
  revalidatePath("/", "layout");
  return { ok: true, error: null };
}

// Schema de un data source, para armar el mapeo de propiedades. El buscador de
// Notion no siempre devuelve las opciones de cada select, así que se pide aparte.
export async function loadNotionProperties(
  dataSourceId: string,
): Promise<{ ok: true; properties: NotionProperty[] } | { ok: false; error: string }> {
  if (!(await requireAdmin())) return { ok: false, error: "Solo un administrador puede configurar Notion." };
  if (!dataSourceId) return { ok: false, error: "Elegí una database." };

  try {
    const ds = await getDataSource(dataSourceId);
    return { ok: true, properties: ds.properties };
  } catch (e) {
    console.error("[notion] loadNotionProperties", e);
    return { ok: false, error: notionErrorMessage(e) };
  }
}
