// Compartido entre server y cliente (sin imports de server).
export const LOGOS_BUCKET = "intranet-client-logos";
export const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;

// Tag del cache del listado del bucket (ver getLogoUrls en lib/data.ts).
export const LOGOS_TAG = "client-logos";
