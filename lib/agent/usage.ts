// Consumo de IA de la intranet: cuánto salió cada uso y quién lo hizo, separado
// por tipo (el agente, los reportes, los análisis de campañas).
//
// El costo se estima acá a partir de los tokens que devuelve la API. NO es la
// factura de Anthropic: no contempla descuentos, batch ni el resto del consumo de
// la organización. Sirve para saber qué gasta la intranet y quién la usa.
import type Anthropic from "@anthropic-ai/sdk";
import { createClient, isMissingTable } from "../supabase/server";

// Tipos de uso, en el orden en que se muestran en /admin. Coincide con el check
// de intranet_agent_usage.kind (docs/sql/2026-09-28-uso-por-tipo.sql).
export const USAGE_KINDS = [
  { kind: "agente", title: "Agente Q", unit: ["consulta", "consultas"], empty: "Todavía nadie usó Agente Q en este período." },
  { kind: "reporte", title: "Reportes", unit: ["reporte", "reportes"], empty: "Todavía no se generaron reportes en este período." },
  {
    kind: "analisis",
    title: "Análisis de campañas",
    unit: ["análisis", "análisis"],
    empty: "Todavía no se generaron análisis de campañas en este período.",
  },
] as const;

export type UsageKind = (typeof USAGE_KINDS)[number]["kind"];

// Sin la columna kind: 42703 si responde Postgres, PGRST204 si PostgREST no la tiene en su cache.
const missingColumn = (error: { code?: string } | null) => error?.code === "42703" || error?.code === "PGRST204";

// Dólares por millón de tokens, como los publica Anthropic. La entrada cacheada
// no se cobra igual: escribir en el cache cuesta ~1,25x un token de entrada y
// leerlo ~0,1x, así que se calculan aparte.
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
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

// Una fila por uso. Se escribe con la sesión del usuario, así que la RLS
// garantiza que nadie registre consumo a nombre de otro.
export async function recordUsage(
  kind: UsageKind,
  userId: string,
  threadId: string | null,
  model: string,
  tokens: TokenCounts,
) {
  const supabase = await createClient();
  const row = {
    kind,
    user_id: userId,
    thread_id: threadId,
    model,
    input_tokens: tokens.input,
    output_tokens: tokens.output,
    cache_creation_tokens: tokens.cacheCreation,
    cache_read_tokens: tokens.cacheRead,
    cost_usd: costOf(model, tokens),
  };
  let { error } = await supabase.from("intranet_agent_usage").insert(row);
  // Mientras no se corra el SQL de kind, se guarda sin el tipo (cuenta como agente).
  if (missingColumn(error)) {
    const rest: Record<string, unknown> = { ...row };
    delete rest.kind;
    ({ error } = await supabase.from("intranet_agent_usage").insert(rest));
  }
  // El registro de consumo no puede tumbar una respuesta ya entregada.
  if (error && !isMissingTable(error)) console.error("[agente] recordUsage", error);
}

// ---------- Lectura para el panel de administración ----------

export type UsageTotals = {
  usos: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
};

export type UsageByUser = UsageTotals & { userId: string; ultima: string };

export type UsageSection = { kind: UsageKind; total: UsageTotals; porUsuario: UsageByUser[] };

export type AiUsage = {
  dias: number;
  desde: string;
  total: UsageTotals;
  // Una por tipo, en el orden de USAGE_KINDS (también las vacías).
  secciones: UsageSection[];
  // La tabla todavía no existe (falta correr el SQL): la vista lo dice en vez de
  // mostrar un cero que parecería "nadie lo usó".
  sinTabla: boolean;
  // Falta la columna kind: todo figura como agente hasta correr el SQL.
  sinTipo: boolean;
};

type UsageRow = {
  kind?: string;
  user_id: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cost_usd: string | number;
  created_at: string;
};

const sumInto = (target: UsageTotals, row: UsageRow) => {
  target.usos += 1;
  target.costUsd += Number(row.cost_usd);
  target.inputTokens += row.input_tokens;
  target.outputTokens += row.output_tokens;
  target.cacheReadTokens += row.cache_read_tokens;
};

const zero = (): UsageTotals => ({ usos: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 });

const COLUMNS = "user_id, input_tokens, output_tokens, cache_read_tokens, cost_usd, created_at";

// Consumo del período, por tipo y por usuario. Se agrupa en JS y no en SQL: es
// una fila por uso de un equipo interno, no un volumen que justifique una vista.
export async function getAiUsage(days = 30): Promise<AiUsage> {
  const desde = new Date(Date.now() - days * 86_400_000).toISOString();
  const supabase = await createClient();
  const read = (columns: string) =>
    supabase
      .from("intranet_agent_usage")
      .select(columns)
      .gte("created_at", desde)
      .order("created_at", { ascending: false })
      .returns<UsageRow[]>();

  let { data, error } = await read(`kind, ${COLUMNS}`);
  const sinTipo = missingColumn(error);
  if (sinTipo) ({ data, error } = await read(COLUMNS));

  const empty: AiUsage = {
    dias: days,
    desde,
    total: zero(),
    secciones: USAGE_KINDS.map(({ kind }) => ({ kind, total: zero(), porUsuario: [] })),
    sinTabla: false,
    sinTipo,
  };
  if (error) {
    if (isMissingTable(error)) return { ...empty, sinTabla: true };
    throw error;
  }

  const total = zero();
  const byKind = new Map<UsageKind, { total: UsageTotals; users: Map<string, UsageByUser> }>(
    USAGE_KINDS.map(({ kind }) => [kind, { total: zero(), users: new Map() }]),
  );

  for (const row of data ?? []) {
    sumInto(total, row);
    const section = byKind.get((row.kind ?? "agente") as UsageKind) ?? byKind.get("agente")!;
    sumInto(section.total, row);
    // Las filas vienen de la más nueva a la más vieja, así que la primera de cada
    // usuario es su último uso.
    const user = section.users.get(row.user_id) ?? { ...zero(), userId: row.user_id, ultima: row.created_at };
    sumInto(user, row);
    section.users.set(row.user_id, user);
  }

  return {
    ...empty,
    total,
    secciones: USAGE_KINDS.map(({ kind }) => {
      const section = byKind.get(kind)!;
      return { kind, total: section.total, porUsuario: [...section.users.values()].sort((a, b) => b.costUsd - a.costUsd) };
    }),
  };
}
