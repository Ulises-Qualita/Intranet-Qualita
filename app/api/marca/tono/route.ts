import { type NextRequest } from "next/server";
import { getAreaSession } from "@/lib/auth";
import { locateVoiceExamples } from "@/lib/brand";
import { getClient } from "@/lib/data";

export const maxDuration = 300;

// Ejemplos de cómo habla la marca (lib/brand.ts, locateVoiceExamples), para
// manuales leídos antes de que existieran. Lo llama solo el tablero del equipo.
// Solo equipo.
export async function POST(request: NextRequest) {
  const session = await getAreaSession("clientes");
  if (!session) return Response.json({ ok: false, error: "Sin acceso." }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { client?: string } | null;
  const client = body?.client ? await getClient(body.client) : null;
  if (!client) return Response.json({ ok: false, error: "Cliente no encontrado." }, { status: 404 });

  const result = await locateVoiceExamples(client.id, session.user.id);
  return Response.json(result, { status: result.ok ? 200 : 422 });
}
