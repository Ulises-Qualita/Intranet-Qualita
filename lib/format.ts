// Formateo de números y fechas para la UI (es-AR). Se usa en Server Components.

const TZ = "America/Argentina/Buenos_Aires";

const num = (value: number, maxDecimals = 0) =>
  value.toLocaleString("es-AR", { maximumFractionDigits: maxDecimals });

export function compact(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${num(value / 1_000_000, 1)}M`;
  if (abs >= 10_000) return `${num(value / 1_000, 0)}K`;
  if (abs >= 1_000) return `${num(value / 1_000, 1)}K`;
  return num(value);
}

export const integer = (value: number) => num(value);

export const money = (value: number, decimals = 0) => `$${num(value, decimals)}`;

export const percent = (value: number, decimals = 1) => `${num(value, decimals)}%`;

export const ratio = (value: number) => `${num(value, 1)}x`;

// Fecha de hoy (YYYY-MM-DD) en horario de Argentina.
export const todayISO = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());

// Día (YYYY-MM-DD) en horario de Argentina de un timestamp: una oportunidad creada
// a las 23 h del 1/9 es del 1/9 acá, aunque en UTC ya sea el 2/9.
const localDay = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });
export const localDate = (iso: string) => localDay.format(new Date(iso));

export function shortDate(isoDate: string) {
  return new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(`${isoDate}T00:00:00Z`))
    .replace(".", "");
}

// Tamaño de un archivo: "840 KB", "12,4 MB".
export function fileSize(bytes: number | null) {
  if (bytes === null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${num(value, value < 10 ? 1 : 0)} ${units[unit]}`;
}

const clock = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ });

// Momento de una sincronización, en hora de Argentina: "hoy a las 08:12 hs",
// "ayer a las 23:40 hs" o "el 12 sept a las 08:12 hs".
export function syncedAt(iso: string) {
  const day = localDate(iso);
  const today = todayISO();
  const yesterday = localDate(new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000).toISOString());
  const when = day === today ? "hoy" : day === yesterday ? "ayer" : `el ${shortDate(day)}`;
  return `${when} a las ${clock.format(new Date(iso))} hs`;
}

// Con año: para fechas que pueden estar lejos, como los hitos de un roadmap.
export function longDate(isoDate: string) {
  return new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${isoDate}T00:00:00Z`))
    .replace(".", "");
}

export function relativeTime(iso: string) {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "recién";
  if (minutes < 60) return `hace ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.round(hours / 24);
  if (days === 1) return "ayer";
  if (days < 30) return `hace ${days} días`;
  return shortDate(iso.slice(0, 10));
}

// Saludo según la hora en Argentina.
export function greeting() {
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: TZ }).format(new Date()));
  if (hour >= 5 && hour < 13) return "Buen día";
  if (hour >= 13 && hour < 20) return "Buenas tardes";
  return "Buenas noches";
}

// Ej.: "martes 15 de septiembre"
export const longToday = () =>
  new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone: TZ }).format(new Date());

// Divisiones de la vista de métricas: sin denominador no hay dato que mostrar.
export const safeDiv = (a: number, b: number) => (b ? a / b : null);
export const orDash = (value: number | null, fmt: (v: number) => string) => (value === null ? "—" : fmt(value));
