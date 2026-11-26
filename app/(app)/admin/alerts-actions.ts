"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { ALERTS_SETTINGS_KEY, ALERT_TYPES, type AlertSettings, type AlertType } from "@/lib/alerts/types";
import { getSession } from "@/lib/auth";
import { createAdminClient, createClient, isMissingTable } from "@/lib/supabase/server";
import { findStart, sendTelegram, telegramBotName, telegramConfigured } from "@/lib/telegram";

// Alertas por Telegram (Administración → Alertas). Solo un rol admin vincula
// chats, prueba envíos y elige quién recibe cada tipo. Las tablas de Telegram y
// de alertas no tienen políticas: se manejan con service_role después de esto.

export type AlertsResult = { ok: true; error: null } | { ok: false; error: string };
type LinkResult = { ok: true; url: string } | { ok: false; error: string };

const PATH = "/admin/alertas";
const NO_ADMIN = { ok: false, error: "Solo un administrador puede configurar las alertas." } as const;
const MISSING = { ok: false, error: "Falta correr docs/sql/2026-11-26-alertas.sql en Supabase." } as const;
const NO_BOT = { ok: false, error: "Falta cargar TELEGRAM_BOT_TOKEN en el servidor." } as const;

async function requireAdmin() {
  const session = await getSession();
  return session?.profile?.role === "admin" && session.profile.active ? session : null;
}

async function activeProfile(profileId: string) {
  const { data } = await createAdminClient()
    .from("intranet_profiles")
    .select("id, active")
    .eq("id", profileId)
    .maybeSingle<{ id: string; active: boolean }>();
  return data?.active ? data : null;
}

// Link al bot con un código de un solo uso. Sirve para la persona misma o para
// mandárselo a otro del equipo: al tocar "Iniciar" en Telegram queda listo para verificar.
export async function createTelegramLink(profileId: string): Promise<LinkResult> {
  if (!(await requireAdmin())) return NO_ADMIN;
  if (!telegramConfigured()) return NO_BOT;
  if (!(await activeProfile(profileId))) return { ok: false, error: "Esa persona no está activa en la intranet." };

  const code = randomBytes(9).toString("base64url");
  const { error } = await createAdminClient()
    .from("intranet_telegram_links")
    .upsert({ profile_id: profileId, code, code_at: new Date().toISOString() }, { onConflict: "profile_id" });
  if (error) return isMissingTable(error) ? MISSING : { ok: false, error: "No se pudo preparar el link." };
  try {
    return { ok: true, url: `https://t.me/${await telegramBotName()}?start=${code}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "No se pudo leer el bot de Telegram." };
  }
}

// Busca el "/start <código>" que mandó Telegram y guarda el chat.
export async function verifyTelegramLink(profileId: string): Promise<AlertsResult> {
  if (!(await requireAdmin())) return NO_ADMIN;
  if (!telegramConfigured()) return NO_BOT;
  const db = createAdminClient();
  const { data: row, error } = await db
    .from("intranet_telegram_links")
    .select("code")
    .eq("profile_id", profileId)
    .maybeSingle<{ code: string | null }>();
  if (error) return isMissingTable(error) ? MISSING : { ok: false, error: "No se pudo leer el vínculo." };
  if (!row?.code) return { ok: false, error: "Primero generá el link de vinculación." };

  let found: Awaited<ReturnType<typeof findStart>>;
  try {
    found = await findStart(row.code);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "No se pudo consultar Telegram." };
  }
  if (!found) return { ok: false, error: "Todavía no llegó el mensaje: abrí el link en Telegram y tocá «Iniciar»." };

  const { error: saveError } = await db
    .from("intranet_telegram_links")
    .update({ chat_id: found.chatId, username: found.username, linked_at: new Date().toISOString(), code: null })
    .eq("profile_id", profileId);
  if (saveError) return { ok: false, error: "No se pudo guardar el vínculo." };
  await sendTelegram(found.chatId, "✅ Listo: vas a recibir acá las alertas de la intranet de Qualita.").catch(() => {});
  revalidatePath(PATH);
  return { ok: true, error: null };
}

export async function unlinkTelegram(profileId: string): Promise<AlertsResult> {
  if (!(await requireAdmin())) return NO_ADMIN;
  const { error } = await createAdminClient().from("intranet_telegram_links").delete().eq("profile_id", profileId);
  if (error) return isMissingTable(error) ? MISSING : { ok: false, error: "No se pudo desvincular." };
  revalidatePath(PATH);
  return { ok: true, error: null };
}

export async function sendTelegramTest(profileId: string): Promise<AlertsResult> {
  if (!(await requireAdmin())) return NO_ADMIN;
  if (!telegramConfigured()) return NO_BOT;
  const { data } = await createAdminClient()
    .from("intranet_telegram_links")
    .select("chat_id")
    .eq("profile_id", profileId)
    .maybeSingle<{ chat_id: number | null }>();
  if (!data?.chat_id) return { ok: false, error: "Esa persona no tiene Telegram vinculado." };
  try {
    await sendTelegram(Number(data.chat_id), "🔔 <b>Prueba</b>\nAsí van a llegar las alertas de la intranet de Qualita.");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "No se pudo mandar el mensaje." };
  }
  return { ok: true, error: null };
}

// Quién recibe cada tipo. Se guarda en intranet_settings (la RLS deja escribir solo al admin).
export async function saveAlertRecipients(recipients: Record<string, string[]>): Promise<AlertsResult> {
  if (!(await requireAdmin())) return NO_ADMIN;
  const clean: Partial<Record<AlertType, string[]>> = {};
  for (const t of ALERT_TYPES) {
    const ids = recipients[t.key];
    clean[t.key] = Array.isArray(ids) ? [...new Set(ids.filter((id) => typeof id === "string"))].slice(0, 50) : [];
  }
  const value: AlertSettings = { recipients: clean };
  const { error } = await (await createClient())
    .from("intranet_settings")
    .upsert({ key: ALERTS_SETTINGS_KEY, value, updated_at: new Date().toISOString() });
  if (error) {
    console.error("[alertas] destinatarios", error);
    return { ok: false, error: "No se pudo guardar." };
  }
  revalidatePath(PATH);
  return { ok: true, error: null };
}
