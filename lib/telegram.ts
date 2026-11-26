// Bot de Telegram de las alertas (lib/alerts/). Solo server: usa
// TELEGRAM_BOT_TOKEN. El bot se crea con @BotFather.
//
// Cada persona vincula su chat con un link t.me/<bot>?start=<código>: al tocar
// "Iniciar", Telegram le manda al bot "/start <código>", que la intranet lee con
// getUpdates (sin webhook, así funciona igual en local y en producción).

const API = "https://api.telegram.org";

export const telegramConfigured = () => !!process.env.TELEGRAM_BOT_TOKEN;

async function call<T>(method: string, body?: Record<string, unknown>): Promise<T> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Falta TELEGRAM_BOT_TOKEN en el servidor.");
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => null)) as { ok: boolean; result?: T; description?: string } | null;
  if (!data?.ok) throw new Error(`Telegram: ${data?.description ?? res.statusText}`);
  return data.result as T;
}

// Texto para parse_mode HTML: solo hay que escapar &, < y >.
export const tgEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function sendTelegram(chatId: number, html: string) {
  await call("sendMessage", { chat_id: chatId, text: html, parse_mode: "HTML", link_preview_options: { is_disabled: true } });
}

let botName: string | null = null;
export async function telegramBotName(): Promise<string> {
  if (!botName) botName = (await call<{ username: string }>("getMe")).username;
  return botName;
}

type Update = {
  update_id: number;
  message?: { text?: string; chat: { id: number; type: string }; from?: { username?: string; first_name?: string } };
};

// Busca el "/start <código>" en los mensajes que recibió el bot (Telegram los
// guarda 24 h). No confirma los updates (sin offset): así varios vínculos
// pendientes no se pisan.
export async function findStart(code: string): Promise<{ chatId: number; username: string | null } | null> {
  const updates = await call<Update[]>("getUpdates", { allowed_updates: ["message"], limit: 100 });
  for (const u of [...updates].reverse()) {
    const text = u.message?.text?.trim() ?? "";
    if (u.message?.chat.type === "private" && text === `/start ${code}`) {
      return { chatId: u.message.chat.id, username: u.message.from?.username ?? u.message.from?.first_name ?? null };
    }
  }
  return null;
}
