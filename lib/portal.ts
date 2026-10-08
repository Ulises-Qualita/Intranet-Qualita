// Portal del cliente: lo que carga el equipo (banner, responsable validador y
// etapas del proyecto). Los hitos van aparte (intranet_client_milestones).
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

// Etapas del proyecto, en orden: la card del % del portal sale de acá (completadas
// sobre el total; "Estamos en" es la primera en curso o, si no hay, la primera
// pendiente). Las define el equipo en Editar portal → Etapas.
export const STAGE_STATUSES = [
  { value: "todo", label: "Pendiente" },
  { value: "doing", label: "En curso" },
  { value: "done", label: "Completada" },
] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number]["value"];
export type PortalStage = { id: string; name: string; status: StageStatus };
export const STAGES_MAX = 30;
export const STAGE_NAME_MAX = 80;

const isStageStatus = (v: unknown): v is StageStatus => STAGE_STATUSES.some((s) => s.value === v);

// Lo que venga (de la base o del editor), normalizado: sin nombre se descarta.
export function parseStages(raw: unknown): PortalStage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): PortalStage | null => {
      if (!item || typeof item !== "object") return null;
      const { id, name, status } = item as Record<string, unknown>;
      const clean = text(name, STAGE_NAME_MAX);
      if (!clean) return null;
      return {
        id: typeof id === "string" && id ? id.slice(0, 40) : Math.random().toString(36).slice(2, 10),
        name: clean,
        status: isStageStatus(status) ? status : "todo",
      };
    })
    .filter((s): s is PortalStage => s !== null)
    .slice(0, STAGES_MAX);
}

export type PortalSettings = {
  validator: PortalValidator | null;
  stages: PortalStage[];
  // Cuándo se subió el banner: va en la URL para que el navegador no muestre el anterior.
  banner: number | null;
  bannerPosition: BannerPosition;
};

export const EMPTY_PORTAL: PortalSettings = { validator: null, stages: [], banner: null, bannerPosition: BANNER_CENTER };

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
  const { validator, stages, banner, bannerPosition } = raw as Record<string, unknown>;
  const v = validator && typeof validator === "object" ? (validator as Record<string, unknown>) : null;
  const parsed: PortalValidator | null = v
    ? { name: text(v.name, VALIDATOR_MAX.name), role: text(v.role, VALIDATOR_MAX.role), phone: text(v.phone, VALIDATOR_MAX.phone) }
    : null;
  return {
    // Sin nombre no hay a quién mostrar.
    validator: parsed?.name ? parsed : null,
    stages: parseStages(stages),
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
