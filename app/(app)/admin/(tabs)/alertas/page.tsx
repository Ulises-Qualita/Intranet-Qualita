import { Card, EmptyState, NoAccess } from "@/components/ui";
import { ALERTS_SETTINGS_KEY, ALERT_TYPES, type AlertSettings } from "@/lib/alerts/types";
import { getAreaSession } from "@/lib/auth";
import { getTeam } from "@/lib/data";
import { relativeTime } from "@/lib/format";
import { createAdminClient, isMissingTable } from "@/lib/supabase/server";
import { telegramBotName, telegramConfigured } from "@/lib/telegram";
import { AlertRecipients, TelegramLinks } from "../../alerts-admin";

type LinkRow = { profile_id: string; chat_id: number | null; username: string | null; code: string | null };
type AlertRow = { key: string; type: string; title: string | null; active: boolean; last_sent_at: string | null; resolved_at: string | null };

// Alertas por Telegram: el bot, el chat de cada persona, quién recibe cada tipo
// y lo último que se mandó. Lo ve el área admin; lo cambia el rol admin.
export default async function AdminAlertasPage() {
  const session = await getAreaSession("admin");
  if (!session) return <NoAccess />;
  const canEdit = session.profile?.role === "admin";

  const db = createAdminClient();
  const configured = telegramConfigured();
  const [team, links, settings, alerts, bot] = await Promise.all([
    getTeam(),
    db.from("intranet_telegram_links").select("profile_id, chat_id, username, code").returns<LinkRow[]>(),
    db.from("intranet_settings").select("value").eq("key", ALERTS_SETTINGS_KEY).maybeSingle<{ value: AlertSettings }>(),
    db
      .from("intranet_alerts")
      .select("key, type, title, active, last_sent_at, resolved_at")
      .not("last_sent_at", "is", null)
      .order("last_sent_at", { ascending: false })
      .limit(30)
      .returns<AlertRow[]>(),
    configured ? telegramBotName().catch(() => null) : Promise.resolve(null),
  ]);
  const missing = isMissingTable(links.error) || isMissingTable(alerts.error);
  const linkOf = new Map((links.data ?? []).map((l) => [l.profile_id, l]));
  const members = team
    .filter((m) => m.active)
    .map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email ?? "",
      role: m.role,
      chat: linkOf.get(m.id)?.chat_id ? (linkOf.get(m.id)?.username ?? "vinculado") : null,
      pending: !!linkOf.get(m.id)?.code,
    }));
  const typeLabel = new Map<string, string>(ALERT_TYPES.map((t) => [t.key, t.label]));

  return (
    <section className="view">
      <Card title="Bot de Telegram" hint={bot ? `@${bot}` : undefined}>
        {!configured ? (
          <div className="alerts-setup">
            <p className="modal-lead">Falta crear el bot y cargar su token. Una sola vez:</p>
            <ol>
              <li>
                En Telegram, abrí <b>@BotFather</b>, mandá <code>/newbot</code> y elegí un nombre (p. ej. «Qualita Alertas») y un
                usuario terminado en <code>bot</code>.
              </li>
              <li>
                Copiá el token que te da y cargalo en Vercel como <code>TELEGRAM_BOT_TOKEN</code> (y en <code>.env.local</code> para
                probar en local). Después, volvé a desplegar.
              </li>
              <li>Volvé acá y vinculá tu Telegram.</li>
            </ol>
          </div>
        ) : !bot ? (
          <p className="form-error">El token de TELEGRAM_BOT_TOKEN no funciona: revisalo con @BotFather.</p>
        ) : (
          <p className="modal-lead">
            Las alertas se revisan con la sincronización de las 6 de la mañana (todas) y de las 18 (solo integraciones), y llegan
            por privado a cada persona vinculada.
          </p>
        )}
      </Card>

      {missing ? (
        <Card title="Alertas" className="mt-4">
          <EmptyState label="Pendiente">Falta correr docs/sql/2026-11-26-alertas.sql en Supabase.</EmptyState>
        </Card>
      ) : (
        <>
          <Card title="Telegram del equipo" hint="Cada persona toca «Iniciar» en el bot desde su link" className="mt-4">
            <TelegramLinks members={members} canEdit={canEdit && !!bot} />
          </Card>

          <Card title="Quién recibe cada alerta" hint="Sin nadie elegido, van a los admins con Telegram" className="mt-4">
            <AlertRecipients
              types={ALERT_TYPES.map((t) => ({ key: t.key, label: t.label, detail: t.detail }))}
              members={members.filter((m) => m.chat)}
              chosen={settings.data?.value?.recipients ?? {}}
              canEdit={canEdit}
            />
          </Card>

          <Card title="Últimas alertas" className="mt-4">
            {(alerts.data ?? []).length === 0 ? (
              <EmptyState label="Sin alertas">Todavía no se mandó ninguna alerta.</EmptyState>
            ) : (
              <ul className="alerts-log">
                {(alerts.data ?? []).map((a) => (
                  <li key={a.key}>
                    <span className={`alerts-dot${a.active ? " on" : ""}`} aria-hidden />
                    <div>
                      <b>{a.title ?? typeLabel.get(a.type) ?? a.type}</b>
                      <span>
                        {typeLabel.get(a.type) ?? a.type} · enviada {relativeTime(a.last_sent_at!)}
                        {a.active ? " · sigue activa" : a.resolved_at ? ` · resuelta ${relativeTime(a.resolved_at)}` : ""}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </section>
  );
}
