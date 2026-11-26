// Corre las alertas y las manda por Telegram. Solo server. Lo llama el cron de
// sincronización (app/api/cron/sync), después de traer los datos.
//
// Cada cosa vigilada tiene una fila en intranet_alerts (por key). Cuando pasa a
// "mal" se avisa una vez (o una por día si el tipo lo pide) y cuando se arregla
// se cierra, con un aviso si el tipo lo tiene. Si no se le pudo mandar a nadie,
// no se marca como enviada: se reintenta en la próxima corrida.
import { todayISO, localDate } from "../format";
import { createAdminClient, isMissingTable } from "../supabase/server";
import { sendTelegram, telegramConfigured, tgEscape } from "../telegram";
import {
  type Check,
  billingChecks,
  creativeChecks,
  creativeFooter,
  integrationChecks,
  loadContext,
  spendChecks,
} from "./checks";
import { ALERTS_SETTINGS_KEY, type AlertSettings, type AlertType } from "./types";

const ICON: Record<AlertType, string> = { integration: "🔌", spend: "⛔", billing: "📉", creative: "🎯" };

type AlertRow = { key: string; type: string; active: boolean; last_sent_at: string | null };
type Recipient = { profileId: string; chatId: number };

// Los chats a los que va cada tipo: lo elegido en Administración → Alertas o,
// si el tipo no tiene nada elegido, los admins con Telegram vinculado.
export async function alertRecipients(): Promise<Record<AlertType, Recipient[]>> {
  const db = createAdminClient();
  const [links, profiles, settings] = await Promise.all([
    db.from("intranet_telegram_links").select("profile_id, chat_id").not("chat_id", "is", null).returns<{ profile_id: string; chat_id: number }[]>(),
    db.from("intranet_profiles").select("id, role, active").returns<{ id: string; role: string; active: boolean }[]>(),
    db.from("intranet_settings").select("value").eq("key", ALERTS_SETTINGS_KEY).maybeSingle<{ value: AlertSettings }>(),
  ]);
  if (links.error) throw links.error;
  const active = new Map((profiles.data ?? []).filter((p) => p.active).map((p) => [p.id, p]));
  const linked = (links.data ?? []).filter((l) => active.has(l.profile_id)).map((l) => ({ profileId: l.profile_id, chatId: Number(l.chat_id) }));
  const chosen = settings.data?.value?.recipients ?? {};
  const forType = (type: AlertType) => {
    const ids = chosen[type];
    return ids ? linked.filter((r) => ids.includes(r.profileId)) : linked.filter((r) => active.get(r.profileId)?.role === "admin");
  };
  return { integration: forType("integration"), spend: forType("spend"), billing: forType("billing"), creative: forType("creative") };
}

async function deliver(recipients: Recipient[], html: string): Promise<number> {
  let sent = 0;
  for (const r of recipients) {
    try {
      await sendTelegram(r.chatId, html);
      sent += 1;
    } catch (e) {
      console.error("[alertas] telegram", r.profileId, e);
    }
  }
  return sent;
}

export type AlertRunResult = { ok: boolean; skipped?: string; checks: number; sent: number; resolved: number };

// morning: la corrida de la mañana suma los chequeos diarios (gasto de ayer,
// facturación y creativos); la de la tarde solo mira las integraciones.
export async function runAlerts({ morning }: { morning: boolean }): Promise<AlertRunResult> {
  if (!telegramConfigured()) return { ok: true, skipped: "Falta TELEGRAM_BOT_TOKEN", checks: 0, sent: 0, resolved: 0 };

  const ctx = await loadContext();
  const types: AlertType[] = morning ? ["integration", "spend", "billing", "creative"] : ["integration"];
  // Un chequeo que falla no corta los demás, y sus alertas abiertas quedan como estaban.
  const failed = new Set<AlertType>();
  const settle = async (type: AlertType, p: Promise<Check[]>) =>
    p.catch((e) => {
      console.error("[alertas] chequeo", type, e);
      failed.add(type);
      return [] as Check[];
    });
  const checks: Check[] = [
    ...integrationChecks(ctx),
    ...(morning
      ? (
          await Promise.all([
            settle("spend", spendChecks(ctx)),
            settle("billing", billingChecks(ctx)),
            settle("creative", creativeChecks(ctx)),
          ])
        ).flat()
      : []),
  ];

  const db = ctx.db;
  const { data: rows, error } = await db
    .from("intranet_alerts")
    .select("key, type, active, last_sent_at")
    .in("type", types)
    .returns<AlertRow[]>();
  if (error) {
    if (isMissingTable(error)) return { ok: false, skipped: "Falta correr docs/sql/2026-11-26-alertas.sql", checks: 0, sent: 0, resolved: 0 };
    throw error;
  }
  const state = new Map((rows ?? []).map((r) => [r.key, r]));
  const recipients = await alertRecipients();
  const today = todayISO();
  const now = new Date().toISOString();

  // Qué hay que mandar: alertas nuevas (o diarias que tocan hoy) y arreglos.
  const toSend = checks.filter((c) => {
    if (c.state !== "bad") return false;
    const row = state.get(c.key);
    if (!row?.active) return true;
    return !!c.repeatDaily && (!row.last_sent_at || localDate(row.last_sent_at) < today);
  });
  const toResolve = checks.filter((c) => c.state === "ok" && state.get(c.key)?.active);
  // Lo que estaba activo y ya no aparece (integración desconectada, anuncio borrado): se cierra sin avisar.
  const seen = new Set(checks.map((c) => c.key));
  const vanished = (rows ?? [])
    .filter((r) => r.active && !seen.has(r.key) && !failed.has(r.type as AlertType))
    .map((r) => r.key);

  let sent = 0;
  // Los del mismo grupo (los creativos de un cliente) van en un solo mensaje.
  const groups = new Map<string, Check[]>();
  for (const c of toSend) groups.set(c.group ?? c.key, [...(groups.get(c.group ?? c.key) ?? []), c]);
  for (const list of groups.values()) {
    const first = list[0];
    const client = first.clientId ? ctx.clients.get(first.clientId) : undefined;
    const footer = first.type === "creative" && client ? `\n${creativeFooter(client)}` : "";
    const html = `${ICON[first.type]} <b>${tgEscape(first.title)}</b>\n${list.map((c) => c.body).join("\n")}${footer}`;
    const delivered = await deliver(recipients[first.type], html);
    if (!delivered) continue;
    sent += 1;
    const { error: upsertError } = await db.from("intranet_alerts").upsert(
      list.map((c) => ({
        key: c.key,
        type: c.type,
        client_id: c.clientId,
        active: true,
        title: c.title,
        message: c.body ?? null,
        last_sent_at: now,
        resolved_at: null,
        ...(state.get(c.key)?.active ? {} : { first_at: now }),
      })),
      { onConflict: "key" },
    );
    if (upsertError) console.error("[alertas] guardar", upsertError);
  }

  for (const c of toResolve) {
    if (c.resolved) await deliver(recipients[c.type], c.resolved);
    await db.from("intranet_alerts").update({ active: false, resolved_at: now }).eq("key", c.key);
  }
  if (vanished.length) await db.from("intranet_alerts").update({ active: false, resolved_at: now }).in("key", vanished);

  return { ok: true, checks: checks.length, sent, resolved: toResolve.length + vanished.length };
}
