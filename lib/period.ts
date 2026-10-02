// Período de las vistas de métricas (vista general, CRM y META). Sin imports de
// server: lo usan las páginas, lib/data.ts y el selector del topbar.
//
// Dos formas en la URL:
// - ?dias=7|30|90: los últimos N días hasta hoy.
// - ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD: un rango elegido en el calendario,
//   con los dos extremos incluidos.
import { shortDate, todayISO } from "./format";

export const RANGES = [7, 30, 90] as const;
export const DEFAULT_RANGE = 30;
// Meta guarda solo esta ventana (ver SYNC_DAYS en lib/meta-sync.ts).
export const META_HISTORY_DAYS = 90;
// El CRM trae las oportunidades abiertas y las cerradas de esta ventana (LEAD_DAYS
// en lib/kommo.ts y lib/odoo.ts): más atrás, faltan las cerradas.
export const CRM_HISTORY_DAYS = 90;

export type Period = {
  since: string;
  until: string;
  // null en un rango elegido a mano.
  days: number | null;
  // Para los subtítulos: "últimos 30 días" o "del 1 sept al 15 sept".
  label: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Resta días a una fecha YYYY-MM-DD sin pasar por la zona horaria local.
export function shiftDate(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function lastDays(days: number): Period {
  const until = todayISO();
  return { since: shiftDate(until, days), until, days, label: `últimos ${days} días` };
}

export function customPeriod(from: string, to: string): Period {
  const today = todayISO();
  let [since, until] = from <= to ? [from, to] : [to, from];
  if (until > today) until = today;
  if (since > until) since = until;
  return { since, until, days: null, label: `del ${shortDate(since)} al ${shortDate(until)}` };
}

// El período inmediatamente anterior, del mismo largo: contra el que se compara.
// Los últimos 30 días se comparan con los 30 de antes; del 1 al 15, con los 15 previos.
export function previousPeriod(p: Period): Period {
  const length = Math.round((Date.parse(`${p.until}T12:00:00Z`) - Date.parse(`${p.since}T12:00:00Z`)) / 86_400_000);
  const until = shiftDate(p.since, 1);
  const since = shiftDate(until, length);
  return { since, until, days: null, label: `del ${shortDate(since)} al ${shortDate(until)}` };
}

// Cómo nombrar ese período al lado del porcentaje: "vs. 30 días anteriores".
export const versusLabel = (p: Period) => (p.days ? `vs. ${p.days} días anteriores` : "vs. período anterior");

// Cualquier otro valor en la URL cae en el período por defecto.
export function readPeriod({ dias, desde, hasta }: { dias?: string; desde?: string; hasta?: string }): Period {
  if (desde && hasta && ISO_DATE.test(desde) && ISO_DATE.test(hasta)) return customPeriod(desde, hasta);
  return lastDays(RANGES.find((r) => String(r) === dias) ?? DEFAULT_RANGE);
}

// Query string para llevar el mismo período a otra vista (p. ej. del CRM a META).
export const periodQuery = (p: Period) => (p.days ? `dias=${p.days}` : `desde=${p.since}&hasta=${p.until}`);

// Las funciones de datos aceptan un período o, como antes, una cantidad de días
// (el agente las sigue llamando así).
export const toPeriod = (p: Period | number) => (typeof p === "number" ? lastDays(p) : p);

// Para completar frases: "Ninguna venta {en los últimos 30 días | del 1 sept al 15 sept}".
export const periodPhrase = (p: Period) => (p.days ? `en los últimos ${p.days} días` : p.label);
