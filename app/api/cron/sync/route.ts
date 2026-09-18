import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { syncAllClarityClients } from "@/lib/clarity-sync";
import { syncAllCrmClients } from "@/lib/crm-sync";
import { syncAllMetaClients } from "@/lib/meta-sync";

// Sincroniza las métricas de Meta, los CRM y Clarity de todos los clientes
// conectados. Lo dispara el cron de Vercel (ver vercel.json), que manda
// `Authorization: Bearer ${CRON_SECRET}`. Se puede llamar a mano con el mismo
// header, y con ?full=1 para rehacer la ventana completa de Meta (90 días).
//
// Clarity va solo en la corrida de la mañana: su API permite 10 consultas por
// proyecto por día y devuelve una ventana de 24 h, así que dos fotos diarias se
// solaparían sin aportar nada. Se puede forzar con ?clarity=1.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Falta CRON_SECRET" }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  // La corrida de las 9 UTC (ver vercel.json) es la que toma la foto diaria.
  const conClarity = params.get("clarity") === "1" || new Date().getUTCHours() < 12;

  const [meta, crm, clarity] = await Promise.all([
    syncAllMetaClients(params.get("full") === "1"),
    syncAllCrmClients(),
    conClarity ? syncAllClarityClients() : Promise.resolve([]),
  ]);
  revalidatePath("/", "layout");

  const summary = (results: { ok: boolean }[]) => ({
    synced: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok),
  });

  return NextResponse.json({
    ok: [...meta, ...crm, ...clarity].every((r) => r.ok),
    meta: summary(meta),
    crm: summary(crm),
    clarity: conClarity ? summary(clarity) : "omitido: la foto de Clarity se toma en la corrida de la mañana",
  });
}
