import { revalidatePath } from "next/cache";
import { type NextRequest } from "next/server";
import { getAreaSession } from "@/lib/auth";
import { getClient } from "@/lib/data";
import { generateReport, ReportError, type ReportStep } from "@/lib/report/generate";

// Esperar a Claude y bajar las portadas de los anuncios lleva un rato.
export const maxDuration = 300;

export type ReportEvent =
  | { type: "step"; step: ReportStep }
  | { type: "thinking"; text: string }
  | { type: "done"; id: string; warning: string | null }
  | { type: "error"; message: string };

// Genera un reporte y va contando el progreso por SSE: cada paso y el
// razonamiento resumido de Claude, para mostrarlos en el modal mientras tanto.
export async function POST(request: NextRequest) {
  const session = await getAreaSession("clientes");
  if (!session) return new Response("Sin acceso", { status: 403 });

  const body = (await request.json().catch(() => null)) as { client?: string; since?: string; until?: string } | null;
  const client = body?.client ? await getClient(body.client) : null;
  if (!client) return new Response("Cliente no encontrado", { status: 404 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: ReportEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      try {
        const result = await generateReport(client, body?.since ?? "", body?.until ?? "", session.user.id, {
          step: (step) => send({ type: "step", step }),
          thinking: (text) => send({ type: "thinking", text }),
        });
        revalidatePath(`/clientes/${client.slug}/reportes`);
        send({ type: "done", ...result });
      } catch (e) {
        if (!(e instanceof ReportError)) console.error("[reportes]", client.id, e);
        send({ type: "error", message: e instanceof ReportError ? e.message : "No se pudo generar el reporte." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
