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
import { fromReportData, type MetricsPeer, parseMetrics } from "./metrics";

// Error con un mensaje para mostrar tal cual en la pantalla.
export class ReportError extends Error {}

export type ReportStep = "datos" | "claude" | "html";

export type ReportProgress = {
  step: (step: ReportStep) => void;
  thinking: (text: string) => void;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Columnas que llegan con docs/sql/2026-11-26-reportes-comparativos.sql.
const missingColumn = (e: { code?: string } | null) => e?.code === "42703" || e?.code === "PGRST204";
const MIGRATION = "Falta correr docs/sql/2026-11-26-reportes-comparativos.sql en Supabase.";

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

// "Septiembre" / "Sep": el mes en el que cae la mayor parte del período.
export function peerLabel(since: string, until: string) {
  const mid = new Date((Date.parse(`${since}T00:00:00Z`) + Date.parse(`${until}T00:00:00Z`)) / 2);
  const label = MONTHS[mid.getUTCMonth()];
  return { label, short: label.slice(0, 3) };
}

// Los reportes guardados contra los que se compara, del más nuevo al más viejo.
async function loadPeers(clientId: string, ids: string[]): Promise<MetricsPeer[]> {
  if (!ids.length) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("intranet_client_reports")
    .select("id, since, until, metrics")
    .eq("client_id", clientId)
    .in("id", ids)
    .returns<{ id: string; since: string; until: string; metrics: unknown }[]>();
  if (error) throw new ReportError(missingColumn(error) ? MIGRATION : "No se pudieron leer los reportes a comparar.");
  const peers: MetricsPeer[] = [];
  for (const row of data ?? []) {
    const metrics = parseMetrics(row.metrics);
    if (!metrics) {
      throw new ReportError(
        `El reporte del ${row.since.split("-").reverse().join("/")} no tiene sus números guardados (se generó antes de los comparativos): generalo de nuevo o subilo con "Cargar un reporte".`,
      );
    }
    peers.push({ id: row.id, since: row.since, until: row.until, metrics, ...peerLabel(row.since, row.until) });
  }
  if (peers.length !== new Set(ids).size) throw new ReportError("No se encontró alguno de los reportes a comparar.");
  // Dos meses con el mismo nombre (de años distintos): se aclara el año.
  const names = peers.map((p) => p.label);
  for (const p of peers) {
    if (names.filter((n) => n === p.label).length > 1) {
      p.label = `${p.label} ${p.since.slice(0, 4)}`;
      p.short = `${p.short} ${p.since.slice(2, 4)}`;
    }
  }
  return peers.sort((a, b) => b.since.localeCompare(a.since));
}

// Quien la llama ya validó el acceso (área clientes) y resolvió el cliente con la RLS.
export async function generateReport(
  client: Client,
  since: string,
  until: string,
  userId: string,
  progress: ReportProgress,
  // Reporte comparativo: los reportes guardados contra los que compara (hasta 3).
  compareIds: string[] = [],
): Promise<{ id: string; warning: string | null }> {
  if (compareIds.length > 3) throw new ReportError("Elegí hasta 3 reportes para comparar.");
  if (!ISO_DATE.test(since) || !ISO_DATE.test(until)) throw new ReportError("Elegí las dos fechas.");
  if (since > until) throw new ReportError("La fecha de inicio es posterior a la de fin.");
  // Meta y el CRM guardan solo los últimos 90 días: antes de eso el reporte saldría vacío.
  const oldest = shiftDate(todayISO(), META_HISTORY_DAYS);
  if (since < oldest) {
    throw new ReportError(
      `Solo hay datos de los últimos ${META_HISTORY_DAYS} días: elegí un inicio desde el ${oldest.split("-").reverse().join("/")}.`,
    );
  }
  if (!client.conn.meta && !client.conn.google_ads && !client.conn.crm && !client.conn.clarity) {
    throw new ReportError("El cliente no tiene Meta, Google Ads, CRM ni Clarity conectados: no hay datos para el reporte.");
  }

  progress.step("datos");
  const peers = await loadPeers(client.id, compareIds);
  const period = customPeriod(since, until);
  const data = await buildReportData(client, period).catch((e) => {
    console.error("[reportes] datos", client.id, e);
    throw new ReportError("No se pudieron leer los datos del período.");
  });
  if (!data.meta && !data.googleAds && !data.crm && !data.clarity) {
    throw new ReportError("No hay datos de Meta, Google Ads, CRM ni Clarity en ese período.");
  }

  // Sin textos el reporte igual sale: con los números y sin las notas.
  progress.step("claude");
  let texts: ReportTexts | null = null;
  let warning: string | null = null;
  try {
    texts = await writeReportTexts(data, userId, progress.thinking, peers);
  } catch (e) {
    console.error("[reportes] textos", client.id, e);
    warning = "Claude no pudo escribir los textos: el reporte salió solo con los números.";
  }

  progress.step("html");
  const supabase = await createClient();
  const base = { client_id: client.id, since: period.since, until: period.until, html: renderReport(data, texts, peers), created_by: userId };
  const insert = (row: Record<string, unknown>) =>
    supabase.from("intranet_client_reports").insert(row).select("id").single<{ id: string }>();
  // Los números del período quedan guardados: así este reporte sirve después para comparar.
  let { data: row, error } = await insert({
    ...base,
    kind: peers.length ? "comparativo" : "generado",
    metrics: fromReportData(data),
    compared_ids: peers.length ? peers.map((p) => p.id) : null,
  });
  // Sin la migración, el reporte de siempre se guarda igual (sin sus números).
  if (missingColumn(error) && !peers.length) ({ data: row, error } = await insert(base));
  if (missingColumn(error)) throw new ReportError(MIGRATION);
  if (error) {
    console.error("[reportes] guardar", client.id, error);
    throw new ReportError(
      isMissingTable(error) ? "Falta crear la tabla de reportes (docs/sql/2026-09-28-reportes.sql)." : "No se pudo guardar el reporte.",
    );
  }
  return { id: row!.id, warning };
}
