import { revalidatePath } from "next/cache";
import { type NextRequest } from "next/server";
import { getAreaSession } from "@/lib/auth";
import { brandPdfUrl, extractBrandBook } from "@/lib/brand";
import { getClient } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

// Leer un brandbook pesado con Claude puede llevar un par de minutos.
export const maxDuration = 300;

// "Leer manual" de la solapa Manual de marca (solo equipo con el área Clientes).
// Es una ruta y no una Server Action por el tiempo que tarda. Si el cliente
// todavía no tiene logos, devuelve dónde están en el PDF (y el link al PDF) para
// que el navegador los recorte y los guarde solo (logo-from-pdf.tsx); lo mismo
// con las aplicaciones y los ejemplos para redes.
export async function POST(request: NextRequest) {
  const session = await getAreaSession("clientes");
  if (!session) return Response.json({ ok: false, error: "Sin acceso." }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { client?: string } | null;
  // getClient lee con la RLS: si el usuario no ve al cliente, no lo encuentra.
  const client = body?.client ? await getClient(body.client) : null;
  if (!client) return Response.json({ ok: false, error: "Cliente no encontrado." }, { status: 404 });

  const { sources, applications, ...result } = await extractBrandBook(client.id, session.user.id);
  revalidatePath(`/clientes/${client.slug}/marca`);
  if (!result.ok) return Response.json(result, { status: 422 });

  let logos = null;
  if (sources?.length) {
    const supabase = await createClient();
    const { count } = await supabase
      .from("intranet_brand_assets")
      .select("id", { count: "exact", head: true })
      .eq("client_id", client.id)
      .eq("kind", "logo");
    if (!count) logos = sources;
  }
  // Aplicaciones y ejemplos para redes que falta recortar (las ya guardadas quedan).
  const apps = applications?.length ? applications : null;
  const pdfUrl = logos || apps ? await brandPdfUrl(client.id, false) : null;
  return Response.json({ ...result, crop: pdfUrl ? { clientId: client.id, pdfUrl, logos, applications: apps } : null });
}
