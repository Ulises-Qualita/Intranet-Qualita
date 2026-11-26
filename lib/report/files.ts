// Archivos de los reportes cargados a mano. Compartido entre server y cliente
// (sin imports de server). Bucket privado: docs/sql/2026-11-26-reportes-comparativos.sql.
export const REPORTS_BUCKET = "intranet-client-reports";
export const REPORT_FILE_TYPES = ["application/pdf", "text/html"] as const;
export type ReportFileType = (typeof REPORT_FILE_TYPES)[number];
export const REPORT_FILE_MAX_BYTES = 20 * 1024 * 1024;

// Tipo del archivo por la extensión: algunos navegadores mandan un HTML sin type.
export function reportFileType(name: string, type: string): ReportFileType | null {
  if (type === "application/pdf" || /\.pdf$/i.test(name)) return "application/pdf";
  if (type === "text/html" || /\.html?$/i.test(name)) return "text/html";
  return null;
}
