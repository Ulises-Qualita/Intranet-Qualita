// Portal del cliente: lo que carga el equipo (banner, responsable validador y
// etapa del proyecto). Los hitos van aparte (intranet_client_milestones).
// Compartido entre server y cliente (sin imports de server). Se guarda en
// intranet_clients.portal (docs/sql/2026-10-05-portal-intranet.sql).

export const BANNERS_BUCKET = "intranet-client-banners";
export const BANNER_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const BANNER_MAX_BYTES = 5 * 1024 * 1024;

export type PortalValidator = { name: string; role: string; phone: string };

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// Qué parte del banner se ve: object-position en % (0 = borde izquierdo / de
// arriba, 100 = derecho / de abajo). Se elige arrastrando la imagen en el portal.
export type BannerPosition = { x: number; y: number };
export const BANNER_CENTER: BannerPosition = { x: 50, y: 50 };

// Etapas del proyecto: las mismas tres para todos los clientes, en este orden. Las
// dos primeras terminan (son la construcción, 50% del % cada una); Motor de Demanda
// es la pauta, un servicio mensual que no termina: en ella el % se reemplaza por ∞.
export const PROJECT_STAGES = [
  { id: "marca", name: "Arquitectura de Marca", ongoing: false },
  { id: "infra", name: "Infraestructura Digital", ongoing: false },
  { id: "motor", name: "Motor de Demanda", ongoing: true },
] as const;
export type StageId = (typeof PROJECT_STAGES)[number]["id"];

// En qué etapa está el cliente y cuánto lleva de ella (0–100, lo carga el equipo en
// Editar portal → Etapas; en Motor de Demanda no se usa). Las anteriores cuentan
// como completadas. Va en `portal.phase`.
export type PortalPhase = { stage: StageId; progress: number };

const isStageId = (v: unknown): v is StageId => PROJECT_STAGES.some((s) => s.id === v);

export function parsePhase(raw: unknown): PortalPhase | null {
  if (!raw || typeof raw !== "object") return null;
  const { stage, progress } = raw as Record<string, unknown>;
  if (!isStageId(stage)) return null;
  const p = typeof progress === "number" && Number.isFinite(progress) ? Math.round(Math.min(100, Math.max(0, progress))) : 0;
  return { stage, progress: stage === "motor" ? 100 : p };
}

export const stageIndex = (stage: StageId) => PROJECT_STAGES.findIndex((s) => s.id === stage);

// % del proyecto: la construcción (marca + infra) es el 100%. null en Motor de
// Demanda, que no tiene fin (el portal muestra ∞).
export function phasePercent(phase: PortalPhase): number | null {
  if (phase.stage === "motor") return null;
  return Math.round((stageIndex(phase.stage) * 100 + phase.progress) / 2);
}

export type PortalSettings = {
  validator: PortalValidator | null;
  phase: PortalPhase | null;
  // Cuándo se subió el banner: va en la URL para que el navegador no muestre el anterior.
  banner: number | null;
  bannerPosition: BannerPosition;
};

export const EMPTY_PORTAL: PortalSettings = { validator: null, phase: null, banner: null, bannerPosition: BANNER_CENTER };

export const VALIDATOR_MAX = { name: 80, role: 80, phone: 40 };

const percent = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 50);

export function parseBannerPosition(raw: unknown): BannerPosition {
  if (!raw || typeof raw !== "object") return BANNER_CENTER;
  const { x, y } = raw as Record<string, unknown>;
  // Con un decimal alcanza.
  return { x: Math.round(percent(x) * 10) / 10, y: Math.round(percent(y) * 10) / 10 };
}

export function parsePortal(raw: unknown): PortalSettings {
  if (!raw || typeof raw !== "object") return EMPTY_PORTAL;
  const { validator, phase, banner, bannerPosition } = raw as Record<string, unknown>;
  const v = validator && typeof validator === "object" ? (validator as Record<string, unknown>) : null;
  const parsed: PortalValidator | null = v
    ? { name: text(v.name, VALIDATOR_MAX.name), role: text(v.role, VALIDATOR_MAX.role), phone: text(v.phone, VALIDATOR_MAX.phone) }
    : null;
  return {
    // Sin nombre no hay a quién mostrar.
    validator: parsed?.name ? parsed : null,
    phase: parsePhase(phase),
    banner: typeof banner === "number" && Number.isFinite(banner) ? banner : null,
    bannerPosition: parseBannerPosition(bannerPosition),
  };
}

// URL pública del banner (bucket público, objeto = client id).
export const bannerUrl = (clientId: string, version: number) =>
  `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BANNERS_BUCKET}/${clientId}?v=${version}`;

// Link de WhatsApp a partir del número como lo cargó el equipo (+54 9 2914 70-2370).
export function whatsappHref(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 8 ? `https://wa.me/${digits}` : null;
}
