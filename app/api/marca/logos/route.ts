import { revalidatePath } from "next/cache";
import { type NextRequest } from "next/server";
import { getAreaSession } from "@/lib/auth";
import { locateBrandLogos } from "@/lib/brand";
import { getClient } from "@/lib/data";

export const maxDuration = 300;

// "Sacar logos del PDF" en un manual leído antes de que Claude marcara dónde está
// el logo: solo busca las cajas (lib/brand.ts, locateBrandLogos). Solo equipo.
export async function POST(request: NextRequest) {
  const session = await getAreaSession("clientes");
  if (!session) return Response.json({ ok: false, error: "Sin acceso." }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { client?: string } | null;
  const client = body?.client ? await getClient(body.client) : null;
  if (!client) return Response.json({ ok: false, error: "Cliente no encontrado." }, { status: 404 });

  const result = await locateBrandLogos(client.id, session.user.id);
  revalidatePath(`/clientes/${client.slug}/marca`);
  return Response.json(result, { status: result.ok ? 200 : 422 });
}
