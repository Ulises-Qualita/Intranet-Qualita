// Agente de Claude de la intranet.
//
// La ANTHROPIC_API_KEY vive solo acá: el navegador habla con este endpoint, nunca
// con Anthropic. El modelo no recibe datos de la intranet en el prompt — los pide
// con herramientas, y la lista de herramientas se arma según las áreas del
// usuario (lib/agent/tools.ts), que además leen con su sesión de Supabase.
//
// La respuesta va por SSE porque una consulta puede encadenar varias
// herramientas y tardar; así el chat muestra qué está haciendo mientras tanto.
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { systemPrompt } from "@/lib/agent/prompt";
import { toolsFor } from "@/lib/agent/tools";
import { deleteThread, getMessages, history, listThreads, openThread, saveMessage, type ToolCall } from "@/lib/agent/threads";
import { addUsage, emptyTokens, recordUsage } from "@/lib/agent/usage";
import { getClients } from "@/lib/data";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Tope de vueltas del loop. Una consulta normal usa 1 o 2; el tope existe para
// que un modelo que se quede pidiendo herramientas no corra para siempre.
const MAX_ITERATIONS = 8;

// Alcanza para una respuesta de chat larga más el razonamiento. Subirlo solo
// sube el techo, pero también el gasto máximo de una pregunta suelta.
const MAX_TOKENS = 16_000;

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5";

// Eventos que consume components/agent/agent-chat.tsx.
type AgentEvent =
  | { type: "thread"; id: string; title: string }
  | { type: "thinking"; text: string }
  | { type: "tool"; name: string }
  | { type: "text"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session?.profile?.active) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "Falta configurar ANTHROPIC_API_KEY en el servidor." }, { status: 500 });
  }

  const body = (await request.json().catch(() => null)) as { message?: string; threadId?: string } | null;
  const question = body?.message?.trim();
  if (!question) return NextResponse.json({ error: "Falta la consulta." }, { status: 400 });

  const tools = toolsFor(session.profile);
  if (!tools.definitions.length) {
    return NextResponse.json({ error: "Tu cuenta todavía no tiene ningún área habilitada." }, { status: 403 });
  }

  const clients = await getClients().catch(() => []);
  const system = systemPrompt({
    userName: session.user.name,
    profile: session.profile,
    clients,
    toolNames: tools.definitions.map((t) => t.name),
  });

  // El hilo se abre antes de llamar al modelo para que el navegador reciba su id
  // enseguida y la próxima pregunta siga la misma conversación.
  const thread = await openThread(body?.threadId ?? null, question, session.user.id).catch((e) => {
    console.error("[agente] openThread", e);
    return null;
  });
  const previous = thread ? await history(thread.id).catch(() => []) : [];
  if (thread) await saveMessage(thread.id, "user", question).catch((e) => console.error("[agente] saveMessage", e));

  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = [
    ...(previous as Anthropic.MessageParam[]),
    { role: "user", content: question },
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: AgentEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

      // Texto final, herramientas usadas y tokens gastados, para guardar el turno
      // al terminar. Una consulta puede dar varias vueltas al modelo y todas se
      // facturan, así que el consumo se acumula vuelta a vuelta.
      let answer = "";
      const used: ToolCall[] = [];
      let tokens = emptyTokens();

      try {
        if (thread) send({ type: "thread", id: thread.id, title: thread.title });

        for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
          const turn = client.messages.stream({
            model: MODEL,
            max_tokens: MAX_TOKENS,
            // El prompt del sistema y las herramientas no cambian en toda la
            // conversación: se cachean y los turnos siguientes salen más baratos.
            system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
            thinking: { type: "adaptive", display: "summarized" },
            tools: tools.definitions,
            messages,
          });

          for await (const event of turn) {
            if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
              // El input del bloque llega recién al cerrarse; con el nombre ya
              // alcanza para que el chat muestre qué está consultando.
              send({ type: "tool", name: event.content_block.name });
            }
            if (event.type !== "content_block_delta") continue;
            if (event.delta.type === "text_delta") {
              answer += event.delta.text;
              send({ type: "text", text: event.delta.text });
            }
            if (event.delta.type === "thinking_delta") send({ type: "thinking", text: event.delta.thinking });
          }

          const message = await turn.finalMessage();
          tokens = addUsage(tokens, message.usage);

          if (message.stop_reason === "refusal") {
            send({ type: "error", message: "Claude no respondió esa consulta." });
            break;
          }
          if (message.stop_reason === "max_tokens") {
            send({ type: "error", message: "La respuesta quedó cortada por el largo. Probá con una pregunta más acotada." });
            break;
          }

          const calls = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
          if (!calls.length) break;

          messages.push({ role: "assistant", content: message.content });

          // En paralelo: el modelo puede pedir varias herramientas en un turno
          // (p. ej. el CRM de tres clientes para compararlos).
          const results = await Promise.all(
            calls.map(async (call) => {
              used.push({ name: call.name, input: (call.input ?? {}) as Record<string, unknown> });
              return {
                type: "tool_result" as const,
                tool_use_id: call.id,
                content: await tools.run(call.name, call.input),
              };
            }),
          );
          messages.push({ role: "user", content: results });

          if (iteration === MAX_ITERATIONS - 1) {
            send({ type: "error", message: "La consulta necesitó demasiadas búsquedas. Probá preguntando por menos clientes a la vez." });
          }
        }

        if (thread && answer.trim()) {
          await saveMessage(thread.id, "assistant", answer, used).catch((e) => console.error("[agente] saveMessage", e));
        }
        send({ type: "done" });
      } catch (e) {
        console.error("[agente]", e);
        const message =
          e instanceof Anthropic.AuthenticationError
            ? "La ANTHROPIC_API_KEY del servidor no es válida."
            : e instanceof Anthropic.RateLimitError
              ? "Claude está limitando las consultas. Probá en un minuto."
              : "No se pudo completar la consulta.";
        send({ type: "error", message });
      } finally {
        // En el finally: si la consulta se cortó a mitad de camino, los tokens de
        // las vueltas que sí corrieron ya se gastaron y tienen que quedar contados.
        if (tokens.input || tokens.output) {
          await recordUsage(session.user.id, thread?.id ?? null, MODEL, tokens);
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

// Lista de conversaciones, o los mensajes de una.
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.profile?.active) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const threadId = request.nextUrl.searchParams.get("hilo");
  if (threadId) return NextResponse.json({ messages: await getMessages(threadId) });
  return NextResponse.json({ threads: await listThreads() });
}

export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session?.profile?.active) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const threadId = request.nextUrl.searchParams.get("hilo");
  if (!threadId) return NextResponse.json({ error: "Falta el hilo." }, { status: 400 });

  // La RLS se encarga de que solo borre los propios.
  await deleteThread(threadId);
  return NextResponse.json({ ok: true });
}
