"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getAreaSession } from "@/lib/auth";
import { getClient } from "@/lib/data";
import { undoReportEdit } from "@/lib/report/edit";
import { REPORT_FILE_MAX_BYTES, REPORTS_BUCKET, reportFileType } from "@/lib/report/files";
import { ReportError } from "@/lib/report/generate";
import { parseMetrics } from "@/lib/report/metrics";
import { createAdminClient, createClient } from "@/lib/supabase/server";

type Result = { ok: boolean; error?: string };
const NO_ACCESS = { ok: false, error: "No tenés acceso a Clientes." } as const;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
// Columnas que llegan con docs/sql/2026-11-26-reportes-comparativos.sql.
const missingColumn = (e: { code?: string } | null) => e?.code === "42703" || e?.code === "PGRST204";
const MIGRATION = "Falta correr docs/sql/2026-11-26-reportes-comparativos.sql en Supabase.";

export async function undoReport(clientSlug: string, id: string): Promise<Result> {
  if (!(await getAreaSession("clientes"))) return NO_ACCESS;
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
export async function deleteReport(clientSlug: string, id: string): Promise<Result> {
  if (!(await getAreaSession("clientes"))) return NO_ACCESS;
  const supabase = await createClient();
  // El archivo de un reporte cargado a mano se borra después (sin la columna, no hay archivo).
  const { data: row } = await supabase
    .from("intranet_client_reports")
    .select("file_path")
    .eq("id", id)
    .maybeSingle<{ file_path: string | null }>();
  const { error } = await supabase.from("intranet_client_reports").delete().eq("id", id);
  if (error) return { ok: false, error: "No se pudo borrar el reporte." };
  if (row?.file_path) await createAdminClient().storage.from(REPORTS_BUCKET).remove([row.file_path]);
  revalidatePath(`/clientes/${clientSlug}/reportes`);
  return { ok: true };
}

// ---------- Reportes cargados a mano ----------

// URL firmada para subir el archivo directo del navegador a Storage (el bucket es
// privado y sin políticas). La ruta empieza con el id del cliente: las otras
// acciones la validan contra eso.
export async function createReportUpload(
  clientSlug: string,
  file: { name: string; type: string; size: number },
): Promise<{ ok: true; path: string; token: string } | { ok: false; error: string }> {
  if (!(await getAreaSession("clientes"))) return NO_ACCESS;
  const type = reportFileType(file.name, file.type);
  if (!type) return { ok: false, error: "Subí el reporte en PDF o HTML." };
  if (file.size > REPORT_FILE_MAX_BYTES) return { ok: false, error: "El archivo no puede pesar más de 20 MB." };

  const client = await getClient(clientSlug);
  if (!client) return { ok: false, error: "Cliente no encontrado." };

  const path = `${client.id}/${randomUUID()}.${type === "application/pdf" ? "pdf" : "html"}`;
  const { data, error } = await createAdminClient().storage.from(REPORTS_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    console.error("[reportes] subida", client.id, error);
    return { ok: false, error: /bucket/i.test(error?.message ?? "") ? MIGRATION : "No se pudo preparar la subida." };
  }
  return { ok: true, path: data.path, token: data.token };
}

// Si se cancela antes de guardar, el archivo subido no queda huérfano.
export async function discardReportUpload(clientSlug: string, path: string): Promise<void> {
  if (!(await getAreaSession("clientes"))) return;
  const client = await getClient(clientSlug);
  if (!client || !path.startsWith(`${client.id}/`)) return;
  await createAdminClient().storage.from(REPORTS_BUCKET).remove([path]);
}

export async function saveManualReport(
  clientSlug: string,
  input: { path: string; fileName: string; since: string; until: string; metrics: unknown },
): Promise<Result> {
  const session = await getAreaSession("clientes");
  if (!session) return NO_ACCESS;
  const client = await getClient(clientSlug);
  if (!client) return { ok: false, error: "Cliente no encontrado." };
  if (!input.path.startsWith(`${client.id}/`)) return { ok: false, error: "El archivo no es de este cliente." };
  if (!ISO.test(input.since) || !ISO.test(input.until)) return { ok: false, error: "Completá el período del reporte." };
  if (input.since > input.until) return { ok: false, error: "La fecha de inicio es posterior a la de fin." };
  const metrics = parseMetrics(input.metrics);
  if (!metrics) return { ok: false, error: "Los números del reporte no son válidos." };

  const supabase = await createClient();
  const { error } = await supabase.from("intranet_client_reports").insert({
    client_id: client.id,
    since: input.since,
    until: input.until,
    html: null,
    kind: "manual",
    metrics,
    file_path: input.path,
    file_name: input.fileName.slice(0, 200),
    created_by: session.user.id,
  });
  if (error) {
    console.error("[reportes] guardar manual", client.id, error);
    return { ok: false, error: missingColumn(error) || error.code === "23502" ? MIGRATION : "No se pudo guardar el reporte." };
  }
  revalidatePath(`/clientes/${clientSlug}/reportes`);
  return { ok: true };
}
