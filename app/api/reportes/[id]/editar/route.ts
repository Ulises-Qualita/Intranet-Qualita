import { type NextRequest } from "next/server";
import { getAreaSession } from "@/lib/auth";
import { type ChatTurn, editReport } from "@/lib/report/edit";
import { ReportError } from "@/lib/report/generate";

// Claude lee el reporte entero y puede reintentar: le damos margen.
export const maxDuration = 300;

export type EditEvent =
  | { type: "thinking"; text: string }
  | { type: "done"; reply: string; applied: number }
  | { type: "error"; message: string };

// Un pedido de cambio sobre un reporte guardado. Por SSE, para mostrar el
// razonamiento de Claude en el chat mientras trabaja.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getAreaSession("clientes");
  if (!session) return new Response("Sin acceso", { status: 403 });

  const body = (await request.json().catch(() => null)) as { message?: string; history?: ChatTurn[] } | null;
  const history = Array.isArray(body?.history) ? body.history : [];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: EditEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      try {
        const result = await editReport(id, history, body?.message ?? "", session.user.id, (text) =>
          send({ type: "thinking", text }),
        );
        send({ type: "done", ...result });
      } catch (e) {
        if (!(e instanceof ReportError)) console.error("[reportes] editar", id, e);
        send({ type: "error", message: e instanceof ReportError ? e.message : "No se pudo hacer el cambio." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
