import { type NextRequest } from "next/server";
import { getAreaSession } from "@/lib/auth";
import { brandPdfUrl, locateBrandApplications } from "@/lib/brand";
import { getClient } from "@/lib/data";

export const maxDuration = 300;

// "Sacar del PDF" en la sección Aplicada: Claude marca dónde están las
// aplicaciones reales y los ejemplos para redes (lib/brand.ts) y devuelve las
// cajas con el link al PDF; el navegador las recorta y las guarda
// (saveApplicationsFromPdf). Solo equipo.
export async function POST(request: NextRequest) {
  const session = await getAreaSession("clientes");
  if (!session) return Response.json({ ok: false, error: "Sin acceso." }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { client?: string; fresh?: boolean } | null;
  const client = body?.client ? await getClient(body.client) : null;
  if (!client) return Response.json({ ok: false, error: "Cliente no encontrado." }, { status: 404 });

  const result = await locateBrandApplications(client.id, session.user.id, body?.fresh === true);
  if (!result.ok) return Response.json(result, { status: 422 });
  const pdfUrl = await brandPdfUrl(client.id, false);
  if (!pdfUrl) return Response.json({ ok: false, error: "No se encontró el PDF." }, { status: 422 });
  return Response.json({ ok: true, clientId: client.id, pdfUrl, applications: result.applications });
}
