// Portal del cliente: lo que carga el equipo (banner y responsable validador).
// Compartido entre server y cliente (sin imports de server). Se guarda en
// intranet_clients.portal (docs/sql/2026-10-05-portal-intranet.sql).

export const BANNERS_BUCKET = "intranet-client-banners";
export const BANNER_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const BANNER_MAX_BYTES = 5 * 1024 * 1024;

export type PortalValidator = { name: string; role: string; phone: string };

export type PortalSettings = {
  validator: PortalValidator | null;
  // Cuándo se subió el banner: va en la URL para que el navegador no muestre el anterior.
  banner: number | null;
};

export const EMPTY_PORTAL: PortalSettings = { validator: null, banner: null };

export const VALIDATOR_MAX = { name: 80, role: 80, phone: 40 };

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function parsePortal(raw: unknown): PortalSettings {
  if (!raw || typeof raw !== "object") return EMPTY_PORTAL;
  const { validator, banner } = raw as Record<string, unknown>;
  const v = validator && typeof validator === "object" ? (validator as Record<string, unknown>) : null;
  const parsed: PortalValidator | null = v
    ? { name: text(v.name, VALIDATOR_MAX.name), role: text(v.role, VALIDATOR_MAX.role), phone: text(v.phone, VALIDATOR_MAX.phone) }
    : null;
  return {
    // Sin nombre no hay a quién mostrar.
    validator: parsed?.name ? parsed : null,
    banner: typeof banner === "number" && Number.isFinite(banner) ? banner : null,
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
