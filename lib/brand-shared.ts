// Manual de marca: tipos, constantes y utilidades compartidas entre server y
// cliente (sin imports de server). Tablas y bucket:
// docs/sql/2026-11-12-manual-de-marca.sql.

export const BRAND_BUCKET = "intranet-brand";

// El PDF del brandbook. Hasta 24 MB va directo a Claude; más pesado se sube a la
// Files API de Anthropic. Tope 115 MB (el del bucket; el del proyecto de
// Supabase, en Settings → Storage, tiene que ser igual o mayor).
export const BRAND_PDF_MAX = 115 * 1024 * 1024;

export type AssetKind = "logo" | "fuente" | "otro";

export const ASSET_KINDS: { id: AssetKind; label: string; accept: string; hint: string }[] = [
  { id: "logo", label: "Logos", accept: ".svg,.png,.jpg,.jpeg,.webp,.pdf,.eps,.ai", hint: "SVG, PNG, JPG, PDF, EPS o AI" },
  { id: "fuente", label: "Tipografías", accept: ".otf,.ttf,.woff,.woff2,.zip", hint: "OTF, TTF, WOFF o un ZIP con la familia" },
  { id: "otro", label: "Otros recursos", accept: "", hint: "Cualquier archivo: plantillas, íconos, mockups" },
];

export const ASSET_MAX = 115 * 1024 * 1024;

export const isAssetKind = (v: unknown): v is AssetKind => ASSET_KINDS.some((k) => k.id === v);

export type BrandColor = {
  name: string;
  hex: string;
  // Lo que diga el manual; si no lo dice, se calcula del HEX al mostrarlo.
  rgb?: string | null;
  cmyk?: string | null;
  pantone?: string | null;
  // Primario, secundario, acento, neutro, fondo…
  role?: string | null;
  usage?: string | null;
};

export type BrandFont = {
  family: string;
  // Títulos, cuerpo, acento…
  role?: string | null;
  weights?: string[];
  usage?: string | null;
  // La familia existe en Google Fonts (se verifica al extraer o al editar).
  google?: boolean;
};

export type BrandData = {
  summary: string;
  colors: BrandColor[];
  fonts: BrandFont[];
  logo: {
    description?: string | null;
    rules: string[];
    // Dónde está cada versión del logo en el PDF (lo marca Claude), para recortarla
    // en el navegador. undefined = todavía no se buscó; [] = no encontró.
    sources?: LogoSource[];
    // Id del recurso (intranet_brand_assets) que es el logo principal, elegido por
    // el equipo. Sin elegir: el que se llama "Principal" o el primero subido.
    main?: string | null;
  };
  voice: { description?: string | null; keywords: string[]; dos: string[]; donts: string[] };
  imagery: string[];
  // Aplicaciones reales y ejemplos para redes que muestra el PDF (los marca Claude
  // y el navegador los recorta). undefined = todavía no se buscaron.
  applications?: BrandApplication[];
  // Imagen de cada página del PDF que tiene aplicaciones, para verlas como en el
  // manual (con las piezas marcadas encima). undefined = todavía no se dibujaron.
  applicationPages?: ApplicationPage[];
  // Con qué criterio se marcaron las aplicaciones (APPS_VERSION). Una lista de un
  // criterio anterior se vuelve a sacar sola.
  applicationsVersion?: number;
};

export type ApplicationPage = { page: number; path: string };

// 2: cada posteo e historia de redes por separado (antes se marcaba la
// composición entera y en el mockup un "posteo" eran varios).
// 3: las fotos se recortan a su resolución real (antes, estiradas a 1800 px,
// salían pixeladas); se vuelven a sacar para recortarlas de nuevo.
// 4: además de las piezas, las muestras de estilo visual (fotos de ejemplo,
// íconos, kit de interfaz), con kind "estilo", para el panel Estilo visual.
export const APPS_VERSION = 4;

// Pieza del manual: dónde está en el PDF y, ya recortada, la imagen en el bucket
// (`{clientId}/aplicacion/…`; null mientras no se recortó).
// kind "estilo": no es una pieza sino una muestra del estilo visual (su `name` es
// el tema: "Fotografía", "Iconografía"…); va al panel Estilo visual, no a la mesa.
export type BrandApplication = LogoSource & { kind: "redes" | "aplicacion" | "estilo"; path?: string | null };

// Página (desde 1) y caja en fracciones de la página (0 a 1, desde arriba a la izquierda).
export type LogoSource = { page: number; name: string; x: number; y: number; w: number; h: number };

export const EMPTY_BRAND: BrandData = {
  summary: "",
  colors: [],
  fonts: [],
  logo: { description: null, rules: [] },
  voice: { description: null, keywords: [], dos: [], donts: [] },
  imagery: [],
};

export type BrandStatus = "sin_extraer" | "extrayendo" | "listo" | "error";

export type BrandBook = {
  clientId: string;
  pdfName: string | null;
  pdfSize: number | null;
  hasPdf: boolean;
  data: BrandData | null;
  status: BrandStatus;
  error: string | null;
  extractedAt: string | null;
  updatedAt: string;
};

export type BrandAsset = {
  id: string;
  kind: AssetKind;
  name: string;
  fileName: string;
  mimeType: string | null;
  size: number | null;
  // URL firmada (bucket privado), armada en el server al renderizar.
  url: string | null;
  createdAt: string;
};

// ---------- Colores ----------

// "#abc", "abc", "#AABBCC" → "#AABBCC". null si no es un HEX.
export function normalizeHex(value: unknown): string | null {
  const raw = String(value ?? "").trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(raw)) return `#${[...raw].map((c) => c + c).join("")}`.toUpperCase();
  if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw}`.toUpperCase();
  return null;
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

export const rgbText = (hex: string) => hexToRgb(hex).join(", ");

// CMYK aproximado (sin perfil de color): solo cuando el manual no trae el suyo.
export function cmykText(hex: string) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return "0, 0, 0, 100";
  return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k].map((v) => Math.round(v * 100)).join(", ");
}

// Luminancia relativa (WCAG).
export function luminance(hex: string) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Texto blanco o navy sobre el color, según cuál se lea mejor.
export const isDark = (hex: string) => luminance(hex) < 0.45;

// Contraste WCAG entre dos colores: de 1 (iguales) a 21 (negro sobre blanco).
export function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// AAA (7+), AA (4,5+: texto normal), AA grande (3+: títulos), o no se lee bien.
export const contrastGrade = (ratio: number) => (ratio >= 7 ? "AAA" : ratio >= 4.5 ? "AA" : ratio >= 3 ? "AA grande" : "Bajo");

// ---------- Tipografías ----------

// Una hoja por peso: si se pide un peso que la familia no tiene, Google responde
// 400 a la hoja entera. Sin peso, el regular (sirve para chequear que existe).
export const googleFontCss = (family: string, weight?: number) =>
  `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family.trim()).replace(/%20/g, "+")}${weight ? `:wght@${weight}` : ""}&display=swap`;

const WEIGHTS: [RegExp, number][] = [
  [/hairline|thin/i, 100],
  [/extra ?light|ultra ?light/i, 200],
  [/light/i, 300],
  [/semi ?bold|demi ?bold/i, 600],
  [/extra ?bold|ultra ?bold/i, 800],
  [/black|heavy/i, 900],
  [/medium/i, 500],
  [/bold/i, 700],
  [/regular|normal|book|roman/i, 400],
];

// "SemiBold", "700", "Bold Italic" → 600, 700, 700. null si no se reconoce.
export function weightOf(name: string): number | null {
  const n = name.match(/\b([1-9]00)\b/);
  if (n) return Number(n[1]);
  return WEIGHTS.find(([re]) => re.test(name))?.[1] ?? null;
}

export const isItalic = (name: string) => /italic|oblique/i.test(name);

export const googleFontPage = (family: string) => `https://fonts.google.com/specimen/${encodeURIComponent(family.trim()).replace(/%20/g, "+")}`;

// "Neue Haas Grotesk" ↔ "NeueHaasGrotesk-Bold.otf": para unir una fuente subida con su familia.
export const fontKey = (s: string) => s.toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]/g, "");
