// "Analizar plataforma": modelo de un análisis y sus recomendaciones. Client-safe
// (lo usan la vista y el server). Tablas: docs/sql/2026-10-15-analisis-plataforma.sql.

export const PLATFORMS = [
  { id: "meta", label: "Meta Ads" },
  { id: "google_ads", label: "Google Ads" },
] as const;
export type Platform = (typeof PLATFORMS)[number]["id"];

export const PRIORITIES = ["alta", "media", "baja"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const EFFORTS = ["bajo", "medio", "alto"] as const;
export type Effort = (typeof EFFORTS)[number];

export const CATEGORIES = [
  "presupuesto",
  "segmentación",
  "creatividades",
  "estructura",
  "puja y optimización",
  "ubicaciones",
  "medición",
  "embudo y ventas",
] as const;

export const TARGET_LEVELS = ["cuenta", "campaña", "conjunto", "anuncio"] as const;
export type TargetLevel = (typeof TARGET_LEVELS)[number];

export const REC_STATUSES = [
  { id: "pendiente", label: "Pendiente" },
  { id: "hecha", label: "Hecha" },
  { id: "descartada", label: "Descartada" },
] as const;
export type RecStatus = (typeof REC_STATUSES)[number]["id"];
export const isRecStatus = (v: unknown): v is RecStatus => REC_STATUSES.some((s) => s.id === v);

// Lo que devuelve Claude (lib/analysis/ai.ts).
export type AnalysisResult = {
  summary: string;
  strengths: string[];
  recommendations: {
    priority: Priority;
    effort: Effort;
    category: string;
    title: string;
    targetLevel: TargetLevel;
    targetName: string;
    action: string;
    reason: string;
    impact: string;
  }[];
};

// Como se guarda y se muestra.
export type Recommendation = {
  id: string;
  position: number;
  priority: Priority;
  effort: Effort;
  category: string;
  title: string;
  target: string;
  action: string;
  reason: string;
  impact: string;
  status: RecStatus;
  statusBy: string | null;
  statusAt: string | null;
};

export type Analysis = {
  id: string;
  platform: Platform;
  since: string;
  until: string;
  summary: string;
  strengths: string[];
  model: string | null;
  createdBy: string | null;
  createdAt: string;
  recommendations: Recommendation[];
};

// "Campaña · Nombre" o "Cuenta".
export const targetLabel = (level: TargetLevel, name: string) =>
  level === "cuenta" || !name ? "Cuenta" : `${level.charAt(0).toUpperCase()}${level.slice(1)} · ${name}`;
