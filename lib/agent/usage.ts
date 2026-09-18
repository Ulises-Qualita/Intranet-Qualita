// Consumo del agente: cuánto salió cada consulta y quién la hizo.
//
// El costo se estima acá a partir de los tokens que devuelve la API. NO es la
// factura de Anthropic: no contempla descuentos, batch ni el resto del consumo de
// la organización. Sirve para saber qué gasta la intranet y quién la usa.
import type Anthropic from "@anthropic-ai/sdk";
import { createClient, isMissingTable } from "../supabase/server";

// Dólares por millón de tokens, como los publica Anthropic. La entrada cacheada
// no se cobra igual: escribir en el cache cuesta ~1,25x un token de entrada y
// leerlo ~0,1x, así que se calculan aparte.
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-fable-5-1": { input: 10, output: 50 },
  "claude-fable-5": { input: 10, output: 50 },
};

const CACHE_WRITE_RATE = 1.25;
const CACHE_READ_RATE = 0.1;
const FALLBACK = PRICES["claude-opus-5"];

export type TokenCounts = {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
};

export const emptyTokens = (): TokenCounts => ({ input: 0, output: 0, cacheCreation: 0, cacheRead: 0 });

// Suma el uso de un turno al acumulado. Una consulta puede dar varias vueltas al
// modelo (una por tanda de herramientas) y cada una se factura por separado.
export function addUsage(total: TokenCounts, usage: Anthropic.Usage): TokenCounts {
  return {
    input: total.input + usage.input_tokens,
    output: total.output + usage.output_tokens,
    cacheCreation: total.cacheCreation + (usage.cache_creation_input_tokens ?? 0),
    cacheRead: total.cacheRead + (usage.cache_read_input_tokens ?? 0),
  };
}

export function costOf(model: string, tokens: TokenCounts): number {
  const price = PRICES[model];
  // Un modelo sin precio en la tabla se cobra al del modelo por defecto: es
  // preferible a contarlo como gratis y que el panel muestre de menos.
  if (!price) console.warn(`[agente] sin precio para "${model}", se estima con el de claude-opus-5`);
  const { input, output } = price ?? FALLBACK;

  return (
    (tokens.input * input +
      tokens.cacheCreation * input * CACHE_WRITE_RATE +
      tokens.cacheRead * input * CACHE_READ_RATE +
      tokens.output * output) /
    1_000_000
  );
}

// Una fila por consulta respondida. Se escribe con la sesión del usuario, así que
// la RLS garantiza que nadie registre consumo a nombre de otro.
export async function recordUsage(userId: string, threadId: string | null, model: string, tokens: TokenCounts) {
  const supabase = await createClient();
  const { error } = await supabase.from("intranet_agent_usage").insert({
    user_id: userId,
    thread_id: threadId,
    model,
    input_tokens: tokens.input,
    output_tokens: tokens.output,
    cache_creation_tokens: tokens.cacheCreation,
    cache_read_tokens: tokens.cacheRead,
    cost_usd: costOf(model, tokens),
  });
  // El registro de consumo no puede tumbar una respuesta ya entregada.
  if (error && !isMissingTable(error)) console.error("[agente] recordUsage", error);
}

// ---------- Lectura para el panel de administración ----------

export type UsageTotals = {
  consultas: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
};

export type UsageByUser = UsageTotals & { userId: string; ultima: string };

export type AgentUsage = {
  dias: number;
  desde: string;
  total: UsageTotals;
  porUsuario: UsageByUser[];
  // La tabla todavía no existe (falta correr el SQL): la vista lo dice en vez de
  // mostrar un cero que parecería "nadie lo usó".
  sinTabla: boolean;
};

type UsageRow = {
  user_id: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cost_usd: string | number;
  created_at: string;
};

const sumInto = (target: UsageTotals, row: UsageRow) => {
  target.consultas += 1;
  target.costUsd += Number(row.cost_usd);
  target.inputTokens += row.input_tokens;
  target.outputTokens += row.output_tokens;
  target.cacheReadTokens += row.cache_read_tokens;
};

const zero = (): UsageTotals => ({ consultas: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 });

// Consumo del período, total y por usuario. Se agrupa en JS y no en SQL: es una
// fila por consulta de un equipo interno, no un volumen que justifique una vista.
export async function getAgentUsage(days = 30): Promise<AgentUsage> {
  const desde = new Date(Date.now() - days * 86_400_000).toISOString();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("intranet_agent_usage")
    .select("user_id, model, input_tokens, output_tokens, cache_read_tokens, cost_usd, created_at")
    .gte("created_at", desde)
    .order("created_at", { ascending: false })
    .returns<UsageRow[]>();

  const empty: AgentUsage = { dias: days, desde, total: zero(), porUsuario: [], sinTabla: false };
  if (error) {
    if (isMissingTable(error)) return { ...empty, sinTabla: true };
    throw error;
  }

  const total = zero();
  const byUser = new Map<string, UsageByUser>();

  for (const row of data ?? []) {
    sumInto(total, row);
    // Las filas vienen de la más nueva a la más vieja, así que la primera de cada
    // usuario es su última consulta.
    const user = byUser.get(row.user_id) ?? { ...zero(), userId: row.user_id, ultima: row.created_at };
    sumInto(user, row);
    byUser.set(row.user_id, user);
  }

  return { ...empty, total, porUsuario: [...byUser.values()].sort((a, b) => b.costUsd - a.costUsd) };
}
