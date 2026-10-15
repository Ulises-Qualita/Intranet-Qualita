import { revalidatePath } from "next/cache";
import { type NextRequest } from "next/server";
import { getAreaSession } from "@/lib/auth";
import { canAccess } from "@/lib/auth-shared";
import { getClient } from "@/lib/data";
import { AnalysisError, type AnalysisStep, generateAnalysis } from "@/lib/analysis/generate";
import { PLATFORMS, type Platform } from "@/lib/analysis/shared";
import { featureEnabled } from "@/lib/features";
import { readPeriod } from "@/lib/period";

// Leer la cuenta en vivo y esperar a Claude (con esfuerzo alto) lleva un rato.
export const maxDuration = 300;

export type AnalysisEvent =
  | { type: "step"; step: AnalysisStep }
  | { type: "done"; id: string; dropped: number }
  | { type: "error"; message: string };

// "Analizar plataforma" (solapas META y GADS, solo equipo con el área META). Va
// contando el progreso por SSE, paso por paso.
export async function POST(request: NextRequest) {
  const session = await getAreaSession("meta");
  if (!session) return new Response("Sin acceso", { status: 403 });
  if (!(await featureEnabled("platformAnalysis"))) return new Response("La función está desactivada", { status: 403 });

  const body = (await request.json().catch(() => null)) as {
    client?: string;
    platform?: string;
    mes?: string;
    dias?: string;
    desde?: string;
    hasta?: string;
  } | null;
  const platform = PLATFORMS.find((p) => p.id === body?.platform)?.id as Platform | undefined;
  if (!platform) return new Response("Plataforma desconocida", { status: 400 });
  const client = body?.client ? await getClient(body.client) : null;
  if (!client) return new Response("Cliente no encontrado", { status: 404 });
  const period = readPeriod({ mes: body?.mes, dias: body?.dias, desde: body?.desde, hasta: body?.hasta });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: AnalysisEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      try {
        const result = await generateAnalysis(
          client,
          platform,
          period,
          { id: session.user.id, seesCrm: canAccess(session.profile, "crm") },
          { step: (step) => send({ type: "step", step }) },
        );
        revalidatePath(`/clientes/${client.slug}/${platform === "meta" ? "meta" : "gads"}/analisis`);
        send({ type: "done", ...result });
      } catch (e) {
        if (!(e instanceof AnalysisError)) console.error("[analisis]", client.id, e);
        send({ type: "error", message: e instanceof AnalysisError ? e.message : "No se pudo generar el análisis." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
