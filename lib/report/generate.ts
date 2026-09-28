// Generación de un reporte, paso a paso. Solo server. La usa el endpoint SSE de
// la solapa Reportes (app/api/reportes/route.ts), que va mostrando cada paso y el
// razonamiento de Claude en un modal.
import type { Client } from "../data";
import { todayISO } from "../format";
import { customPeriod, META_HISTORY_DAYS, shiftDate } from "../period";
import { createClient, isMissingTable } from "../supabase/server";
import { type ReportTexts, writeReportTexts } from "./ai";
import { buildReportData } from "./data";
import { renderReport } from "./html";

// Error con un mensaje para mostrar tal cual en la pantalla.
export class ReportError extends Error {}

export type ReportStep = "datos" | "claude" | "html";

export type ReportProgress = {
  step: (step: ReportStep) => void;
  thinking: (text: string) => void;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Quien la llama ya validó el acceso (área clientes) y resolvió el cliente con la RLS.
export async function generateReport(
  client: Client,
  since: string,
  until: string,
  userId: string,
  progress: ReportProgress,
): Promise<{ id: string; warning: string | null }> {
  if (!ISO_DATE.test(since) || !ISO_DATE.test(until)) throw new ReportError("Elegí las dos fechas.");
  if (since > until) throw new ReportError("La fecha de inicio es posterior a la de fin.");
  // Meta y el CRM guardan solo los últimos 90 días: antes de eso el reporte saldría vacío.
  const oldest = shiftDate(todayISO(), META_HISTORY_DAYS);
  if (since < oldest) {
    throw new ReportError(
      `Solo hay datos de los últimos ${META_HISTORY_DAYS} días: elegí un inicio desde el ${oldest.split("-").reverse().join("/")}.`,
    );
  }
  if (!client.conn.meta && !client.conn.crm && !client.conn.clarity) {
    throw new ReportError("El cliente no tiene Meta, CRM ni Clarity conectados: no hay datos para el reporte.");
  }

  progress.step("datos");
  const period = customPeriod(since, until);
  const data = await buildReportData(client, period).catch((e) => {
    console.error("[reportes] datos", client.id, e);
    throw new ReportError("No se pudieron leer los datos del período.");
  });
  if (!data.meta && !data.crm && !data.clarity) throw new ReportError("No hay datos de Meta, CRM ni Clarity en ese período.");

  // Sin textos el reporte igual sale: con los números y sin las notas.
  progress.step("claude");
  let texts: ReportTexts | null = null;
  let warning: string | null = null;
  try {
    texts = await writeReportTexts(data, userId, progress.thinking);
  } catch (e) {
    console.error("[reportes] textos", client.id, e);
    warning = "Claude no pudo escribir los textos: el reporte salió solo con los números.";
  }

  progress.step("html");
  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("intranet_client_reports")
    .insert({ client_id: client.id, since: period.since, until: period.until, html: renderReport(data, texts), created_by: userId })
    .select("id")
    .single<{ id: string }>();
  if (error) {
    console.error("[reportes] guardar", client.id, error);
    throw new ReportError(
      isMissingTable(error) ? "Falta crear la tabla de reportes (docs/sql/2026-09-28-reportes.sql)." : "No se pudo guardar el reporte.",
    );
  }
  return { id: row.id, warning };
}
