import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { syncAllCrmClients } from "@/lib/crm-sync";
import { syncAllMetaClients } from "@/lib/meta-sync";

// Sincroniza las métricas de Meta y los CRM de todos los clientes conectados.
// Lo dispara el cron de Vercel (ver vercel.json), que manda
// `Authorization: Bearer ${CRON_SECRET}`. Se puede llamar a mano con el mismo
// header, y con ?full=1 para rehacer la ventana completa de Meta (90 días).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Falta CRON_SECRET" }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const [meta, crm] = await Promise.all([
    syncAllMetaClients(request.nextUrl.searchParams.get("full") === "1"),
    syncAllCrmClients(),
  ]);
  revalidatePath("/", "layout");

  const summary = (results: { ok: boolean }[]) => ({
    synced: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok),
  });

  return NextResponse.json({
    ok: [...meta, ...crm].every((r) => r.ok),
    meta: summary(meta),
    crm: summary(crm),
  });
}
