"use server";

import { revalidatePath } from "next/cache";
import { getAreaSession } from "@/lib/auth";
import { undoReportEdit } from "@/lib/report/edit";
import { ReportError } from "@/lib/report/generate";
import { createClient } from "@/lib/supabase/server";

export async function undoReport(clientSlug: string, id: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await getAreaSession("clientes"))) return { ok: false, error: "No tenés acceso a Clientes." };
  try {
    await undoReportEdit(id);
  } catch (e) {
    return { ok: false, error: e instanceof ReportError ? e.message : "No se pudo deshacer el cambio." };
  }
  revalidatePath(`/clientes/${clientSlug}/reportes`);
  return { ok: true };
}

// La generación va por SSE (app/api/reportes/route.ts) para mostrar el progreso;
// acá queda solo lo que es una acción puntual.
export async function deleteReport(clientSlug: string, id: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await getAreaSession("clientes"))) return { ok: false, error: "No tenés acceso a Clientes." };
  const supabase = await createClient();
  const { error } = await supabase.from("intranet_client_reports").delete().eq("id", id);
  if (error) return { ok: false, error: "No se pudo borrar el reporte." };
  revalidatePath(`/clientes/${clientSlug}/reportes`);
  return { ok: true };
}
