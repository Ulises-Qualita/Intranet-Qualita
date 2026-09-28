import { type NextRequest } from "next/server";
import { getAreaSession } from "@/lib/auth";
import { getAllClients } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

// Sirve un reporte guardado: se abre en el navegador, o se descarga con ?descargar=1.
// Se lee con la sesión del usuario: la RLS solo deja ver los reportes al equipo.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await getAreaSession("clientes"))) return new Response("Sin acceso", { status: 403 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("intranet_client_reports")
    .select("html, since, until, client_id")
    .eq("id", id)
    .maybeSingle<{ html: string; since: string; until: string; client_id: string }>();
  if (error || !data) return new Response("Reporte no encontrado", { status: 404 });

  const client = (await getAllClients()).find((c) => c.id === data.client_id);
  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "private, no-store",
    // El HTML trae nombres de anuncios y vendedores escritos por terceros (ya
    // escapados): igual se abre en un origen aislado, sin acceso a la sesión.
    "Content-Security-Policy": "sandbox allow-scripts allow-popups",
  });
  if (request.nextUrl.searchParams.has("descargar")) {
    const name = `Reporte-${client?.slug ?? "cliente"}-${data.since}-a-${data.until}.html`;
    headers.set("Content-Disposition", `attachment; filename="${name}"`);
  }
  return new Response(data.html, { headers });
}
