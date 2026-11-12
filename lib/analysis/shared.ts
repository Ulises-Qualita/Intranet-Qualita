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

// Categorías y lugares a los que puede apuntar una recomendación, por plataforma:
// el esquema que recibe Claude usa solo los de la plataforma analizada.
export const CATEGORIES: Record<Platform, readonly string[]> = {
  meta: ["presupuesto", "segmentación", "creatividades", "estructura", "puja y optimización", "ubicaciones", "medición", "embudo y ventas"],
  google_ads: [
    "presupuesto",
    "palabras clave",
    "términos de búsqueda",
    "anuncios y recursos",
    "segmentación",
    "estructura",
    "puja y optimización",
    "redes y dispositivos",
    "medición",
    "embudo y ventas",
  ],
};

export const TARGET_LEVELS = ["cuenta", "campaña", "conjunto", "grupo de anuncios", "grupo de recursos", "palabra clave", "anuncio"] as const;
export type TargetLevel = (typeof TARGET_LEVELS)[number];

export const PLATFORM_TARGET_LEVELS: Record<Platform, readonly TargetLevel[]> = {
  meta: ["cuenta", "campaña", "conjunto", "anuncio"],
  google_ads: ["cuenta", "campaña", "grupo de anuncios", "grupo de recursos", "palabra clave", "anuncio"],
};

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
