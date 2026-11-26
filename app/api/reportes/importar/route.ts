import { type NextRequest } from "next/server";
import { getAreaSession } from "@/lib/auth";
import { getClient } from "@/lib/data";
import { REPORTS_BUCKET } from "@/lib/report/files";
import { extractReportMetrics } from "@/lib/report/import";
import { createAdminClient } from "@/lib/supabase/server";

// Claude lee un PDF largo en un rato.
export const maxDuration = 300;

// Lee el archivo de un reporte cargado a mano (ya subido a Storage) y devuelve
// sus números para que el equipo los revise. No guarda nada: eso lo hace
// saveManualReport cuando se confirma.
export async function POST(request: NextRequest) {
  const session = await getAreaSession("clientes");
  if (!session) return Response.json({ error: "Sin acceso." }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { client?: string; path?: string } | null;
  const client = body?.client ? await getClient(body.client) : null;
  if (!client) return Response.json({ error: "Cliente no encontrado." }, { status: 404 });
  const path = body?.path ?? "";
  if (!path.startsWith(`${client.id}/`)) return Response.json({ error: "El archivo no es de este cliente." }, { status: 400 });

  const { data: blob, error } = await createAdminClient().storage.from(REPORTS_BUCKET).download(path);
  if (error || !blob) return Response.json({ error: "No se pudo leer el archivo subido." }, { status: 404 });

  try {
    const result = await extractReportMetrics(
      { bytes: Buffer.from(await blob.arrayBuffer()), type: path.endsWith(".pdf") ? "application/pdf" : "text/html" },
      client.name,
      session.user.id,
    );
    return Response.json(result);
  } catch (e) {
    console.error("[reportes] importar", client.id, e);
    return Response.json({ error: e instanceof Error ? e.message : "Claude no pudo leer el reporte." }, { status: 500 });
  }
}
