import { type NextRequest } from "next/server";
import { getAreaSession } from "@/lib/auth";
import { getAllClients } from "@/lib/data";
import { REPORTS_BUCKET } from "@/lib/report/files";
import { createAdminClient, createClient } from "@/lib/supabase/server";

type Row = { html: string | null; since: string; until: string; client_id: string; file_path?: string | null; file_name?: string | null };

// Sirve un reporte guardado: se abre en el navegador, o se descarga con ?descargar=1.
// Se lee con la sesión del usuario: la RLS solo deja ver los reportes al equipo.
// Un reporte cargado a mano no tiene HTML propio: se sirve su archivo de Storage.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await getAreaSession("clientes"))) return new Response("Sin acceso", { status: 403 });

  const supabase = await createClient();
  const read = (columns: string) =>
    supabase.from("intranet_client_reports").select(columns).eq("id", id).maybeSingle<Row>();
  // file_path llega con docs/sql/2026-11-26-reportes-comparativos.sql.
  let { data, error } = await read("html, since, until, client_id, file_path, file_name");
  if (error?.code === "42703" || error?.code === "PGRST204") ({ data, error } = await read("html, since, until, client_id"));
  if (error || !data) return new Response("Reporte no encontrado", { status: 404 });

  const client = (await getAllClients()).find((c) => c.id === data.client_id);
  const download = request.nextUrl.searchParams.has("descargar");
  const baseName = `Reporte-${client?.slug ?? "cliente"}-${data.since}-a-${data.until}`;

  let body: string | ArrayBuffer;
  let type: string;
  let ext: string;
  if (data.html) {
    body = data.html;
    type = "text/html; charset=utf-8";
    ext = "html";
  } else if (data.file_path) {
    const { data: blob } = await createAdminClient().storage.from(REPORTS_BUCKET).download(data.file_path);
    if (!blob) return new Response("No se encontró el archivo del reporte", { status: 404 });
    body = await blob.arrayBuffer();
    const pdf = data.file_path.endsWith(".pdf");
    type = pdf ? "application/pdf" : "text/html; charset=utf-8";
    ext = pdf ? "pdf" : "html";
  } else {
    return new Response("Reporte no encontrado", { status: 404 });
  }

  const headers = new Headers({ "Content-Type": type, "Cache-Control": "private, no-store" });
  // El HTML trae nombres de anuncios y vendedores escritos por terceros (ya
  // escapados), o es un archivo subido: se abre en un origen aislado, sin acceso
  // a la sesión. Al PDF no se le pone: el visor del navegador no abre en sandbox.
  if (ext === "html") headers.set("Content-Security-Policy", "sandbox allow-scripts allow-popups");
  if (download) headers.set("Content-Disposition", `attachment; filename="${baseName}.${ext}"`);
  return new Response(body, { headers });
}
