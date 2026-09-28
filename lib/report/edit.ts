// Modificaciones puntuales de un reporte ya generado, pedidas por chat. Solo server.
//
// Claude no reescribe el HTML: recibe el actual y devuelve reemplazos exactos
// (fragmento → fragmento nuevo), que se aplican acá. Así un pedido chico no puede
// romper el resto del documento. Las imágenes embebidas (varios MB) se cambian por
// marcadores antes de mandarlo y se restituyen al guardar.
import Anthropic from "@anthropic-ai/sdk";
import { addUsage, emptyTokens, recordUsage, type TokenCounts } from "../agent/usage";
import { createClient } from "../supabase/server";
import { ReportError } from "./generate";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5";
// Vueltas extra cuando un fragmento no coincide: se le avisa a Claude y reintenta.
const MAX_RETRIES = 2;
const MAX_TURNS = 12;
const MAX_MESSAGE = 4000;

export type ChatTurn = { role: "user" | "assistant"; content: string };

type EditResponse = { reply: string; edits: { find: string; replace: string }[] };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "edits"],
  properties: {
    reply: {
      type: "string",
      description: "Respuesta breve para el usuario: qué cambiaste, o qué necesitás saber si el pedido no es claro.",
    },
    edits: {
      type: "array",
      description: "Reemplazos a aplicar sobre el HTML actual. Vacío si no hay que cambiar nada.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["find", "replace"],
        properties: {
          find: { type: "string", description: "Fragmento EXACTO del HTML actual, que aparezca una sola vez." },
          replace: { type: "string", description: "Fragmento que lo reemplaza." },
        },
      },
    },
  },
} as const;

const SYSTEM = `Editás reportes de performance en HTML de Qualita Studio (agencia de branding y performance de Argentina) a pedido del equipo. Hablás en español rioplatense, breve y directo.

Recibís el HTML actual del reporte y un pedido. Devolvés reemplazos puntuales:
- "find" tiene que ser un fragmento copiado EXACTO del HTML actual (mismos espacios y comillas) que aparezca una sola vez. Incluí contexto suficiente para que sea único, pero lo mínimo necesario.
- Cambiá solo lo que se pide. No reescribas secciones enteras si no hace falta ni cambies números que no te pidieron.
- Mantené el diseño: usá las clases y variables CSS que ya tiene el documento.
- Las imágenes están reemplazadas por marcadores como __IMG_0__: no los modifiques (podés sacarlos si te piden quitar una imagen).
- No agregues <script>, atributos on...= ni enlaces javascript:.
- No inventes datos. Si te piden un número que no está en el reporte, decí que no lo tenés.
- Si el pedido no se entiende o no se puede hacer, devolvé edits vacío y explicalo en reply.`;

// ---------- Imágenes fuera y adentro ----------

function stripImages(html: string) {
  const images: string[] = [];
  const stripped = html.replace(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, (match) => {
    images.push(match);
    return `__IMG_${images.length - 1}__`;
  });
  return { stripped, images };
}

const restoreImages = (html: string, images: string[]) => html.replace(/__IMG_(\d+)__/g, (m, i) => images[Number(i)] ?? m);

// ---------- Aplicar los reemplazos ----------

const UNSAFE = /<script|javascript:|\son[a-z]+\s*=/i;

const occurrences = (haystack: string, needle: string) => {
  let count = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) count++;
  return count;
};

// Todo o nada: si un reemplazo no se puede aplicar, no se aplica ninguno y se
// devuelve el motivo para que Claude corrija.
function applyEdits(html: string, edits: EditResponse["edits"]): { html: string } | { problems: string[] } {
  const problems: string[] = [];
  let result = html;
  edits.forEach((edit, i) => {
    const label = `Reemplazo ${i + 1}`;
    if (!edit.find) return problems.push(`${label}: "find" está vacío.`);
    if (UNSAFE.test(edit.replace)) return problems.push(`${label}: agrega código ejecutable, no está permitido.`);
    const count = occurrences(result, edit.find);
    if (count === 0) return problems.push(`${label}: el fragmento no aparece en el HTML actual (tiene que ser copia exacta).`);
    if (count > 1) return problems.push(`${label}: el fragmento aparece ${count} veces; agregá contexto para que sea único.`);
    result = result.replace(edit.find, () => edit.replace);
  });
  return problems.length ? { problems } : { html: result };
}

// ---------- Claude ----------

function cleanHistory(history: ChatTurn[]): Anthropic.MessageParam[] {
  return history
    .filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.content === "string" && t.content.trim())
    .slice(-MAX_TURNS)
    .map((t) => ({ role: t.role, content: t.content.slice(0, MAX_MESSAGE) }));
}

async function ask(
  client: Anthropic,
  messages: Anthropic.MessageParam[],
  onThinking: (text: string) => void,
): Promise<{ response: EditResponse; raw: string; usage: Anthropic.Usage }> {
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    system: SYSTEM,
    thinking: { type: "adaptive", display: "summarized" },
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    messages,
  });
  stream.on("streamEvent", (event) => {
    if (event.type === "content_block_delta" && event.delta.type === "thinking_delta") onThinking(event.delta.thinking);
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") throw new ReportError("Claude no quiso hacer ese cambio.");
  if (message.stop_reason === "max_tokens") throw new ReportError("El cambio es demasiado grande: pedilo por partes.");
  const text = message.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new ReportError("Claude no devolvió una respuesta.");
  return { response: JSON.parse(text.text) as EditResponse, raw: text.text, usage: message.usage };
}

export type EditResult = { reply: string; applied: number };

// Quien la llama ya validó el acceso al área clientes; el reporte se lee y se
// escribe con la sesión del usuario (RLS).
export async function editReport(
  reportId: string,
  history: ChatTurn[],
  request: string,
  userId: string,
  onThinking: (text: string) => void,
): Promise<EditResult> {
  const pedido = request.trim().slice(0, MAX_MESSAGE);
  if (!pedido) throw new ReportError("Escribí qué querés cambiar.");

  const supabase = await createClient();
  const { data: report, error } = await supabase
    .from("intranet_client_reports")
    .select("html")
    .eq("id", reportId)
    .maybeSingle<{ html: string }>();
  if (error || !report) throw new ReportError("No se encontró el reporte.");

  const { stripped, images } = stripImages(report.html);
  const messages: Anthropic.MessageParam[] = [
    ...cleanHistory(history),
    { role: "user", content: `HTML actual del reporte:\n\n\`\`\`html\n${stripped}\n\`\`\`\n\nPedido: ${pedido}` },
  ];

  const client = new Anthropic();
  let tokens: TokenCounts = emptyTokens();
  try {
    for (let attempt = 0; ; attempt++) {
      const { response, raw, usage } = await ask(client, messages, onThinking);
      tokens = addUsage(tokens, usage);
      if (!response.edits.length) return { reply: response.reply, applied: 0 };

      const result = applyEdits(stripped, response.edits);
      if ("html" in result) {
        const { error: saveError } = await supabase
          .from("intranet_client_reports")
          .update({ html: restoreImages(result.html, images), previous_html: report.html, edited_at: new Date().toISOString() })
          .eq("id", reportId);
        if (saveError) {
          console.error("[reportes] editar", reportId, saveError);
          throw new ReportError(
            saveError.code === "PGRST204" || saveError.code === "42703"
              ? "Falta correr docs/sql/2026-09-28-reportes-edicion.sql en Supabase."
              : "No se pudo guardar el cambio.",
          );
        }
        return { reply: response.reply, applied: response.edits.length };
      }

      if (attempt >= MAX_RETRIES) {
        throw new ReportError("Claude no logró ubicar el texto a cambiar. Probá describiendo el cambio de otra forma.");
      }
      messages.push(
        { role: "assistant", content: raw },
        {
          role: "user",
          content: `No se aplicó ningún cambio:\n- ${result.problems.join("\n- ")}\n\nVolvé a mandar todos los reemplazos corregidos.`,
        },
      );
    }
  } finally {
    // Aunque falle a mitad de camino, las vueltas que corrieron ya se gastaron.
    if (tokens.input || tokens.output) await recordUsage("reporte", userId, null, MODEL, tokens);
  }
}

// Vuelve a la versión anterior al último cambio (un solo nivel).
export async function undoReportEdit(reportId: string) {
  const supabase = await createClient();
  const { data: report, error } = await supabase
    .from("intranet_client_reports")
    .select("html, previous_html")
    .eq("id", reportId)
    .maybeSingle<{ html: string; previous_html: string | null }>();
  if (error || !report) throw new ReportError("No se encontró el reporte.");
  if (!report.previous_html) throw new ReportError("No hay un cambio para deshacer.");
  const { error: saveError } = await supabase
    .from("intranet_client_reports")
    .update({ html: report.previous_html, previous_html: null, edited_at: new Date().toISOString() })
    .eq("id", reportId);
  if (saveError) throw new ReportError("No se pudo deshacer el cambio.");
}
