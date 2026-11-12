// Criterio de pauta (Administración → Criterio de pauta): constantes y tipos
// compartidos entre server y cliente (sin imports de server). Tabla y bucket:
// docs/sql/2026-11-12-criterio-pauta.sql.
import type { Platform } from "./analysis/shared";

export const CRITERIA_BUCKET = "intranet-ad-criteria";

// Lo que se puede subir. Los PDF y las imágenes los lee Claude tal cual; de los
// Word y los archivos de texto se extrae el texto al subirlos.
export const CRITERIA_FILE_TYPES: Record<string, { mime: string; label: string; max: number }> = {
  pdf: { mime: "application/pdf", label: "PDF", max: 20 * 1024 * 1024 },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", label: "Word", max: 20 * 1024 * 1024 },
  txt: { mime: "text/plain", label: "Texto", max: 5 * 1024 * 1024 },
  md: { mime: "text/markdown", label: "Texto", max: 5 * 1024 * 1024 },
  csv: { mime: "text/csv", label: "CSV", max: 5 * 1024 * 1024 },
  png: { mime: "image/png", label: "Imagen", max: 5 * 1024 * 1024 },
  jpg: { mime: "image/jpeg", label: "Imagen", max: 5 * 1024 * 1024 },
  jpeg: { mime: "image/jpeg", label: "Imagen", max: 5 * 1024 * 1024 },
  webp: { mime: "image/webp", label: "Imagen", max: 5 * 1024 * 1024 },
};

export const CRITERIA_ACCEPT = Object.keys(CRITERIA_FILE_TYPES)
  .map((ext) => `.${ext}`)
  .join(",");

// El tipo se decide por la extensión: el navegador a veces no informa el de un .md.
export const criteriaFileType = (name: string) => CRITERIA_FILE_TYPES[name.split(".").pop()?.toLowerCase() ?? ""] ?? null;

export const MAX_CRITERION_TITLE = 120;
// Un texto escrito o extraído: alcanza de sobra para un manual de pauta.
export const MAX_CRITERION_TEXT = 150_000;

export type AdCriterion = {
  id: string;
  platform: Platform;
  kind: "texto" | "archivo";
  title: string;
  content: string | null;
  filePath: string | null;
  fileName: string | null;
  mimeType: string | null;
  size: number | null;
  active: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export const CRITERIA_PLATFORMS: { id: Platform; label: string }[] = [
  { id: "meta", label: "Meta Ads" },
  { id: "google_ads", label: "Google Ads" },
];
