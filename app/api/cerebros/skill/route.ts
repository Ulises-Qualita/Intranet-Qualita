import { type NextRequest } from "next/server";
import { getAreaSession } from "@/lib/auth";
import { BrainSkillError, generateBrainSkill } from "@/lib/brain-skills";
import { brainArea } from "@/lib/brains";

// Ruta (no Server Action) por el tiempo: Claude escribe la skill entera.
export const maxDuration = 300;

// Genera una versión nueva de la skill de un cerebro de área con sus criterios
// guardados (lib/brain-skills.ts). Solo equipo activo con el área clientes.
export async function POST(request: NextRequest) {
  const session = await getAreaSession("clientes");
  if (!session?.profile?.active) return Response.json({ error: "No tenés acceso a los cerebros." }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { area?: string } | null;
  const area = body?.area ? brainArea(body.area) : undefined;
  if (!area) return Response.json({ error: "Área no encontrada." }, { status: 404 });
  try {
    return Response.json({ skill: await generateBrainSkill(area, session.user.id) });
  } catch (e) {
    if (!(e instanceof BrainSkillError)) console.error("[cerebros] skill", e);
    return Response.json({ error: e instanceof BrainSkillError ? e.message : "No se pudo generar la skill." }, { status: 422 });
  }
}
