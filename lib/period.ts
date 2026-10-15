// Período de las vistas de métricas (vista general, CRM y META). Sin imports de
// server: lo usan las páginas, lib/data.ts y el selector del topbar.
//
// Formas en la URL:
// - ?mes=YYYY-MM: un mes calendario (el actual, hasta hoy). Los atajos del
//   selector son los últimos tres meses (en octubre: agosto, septiembre y octubre)
//   y sin nada en la URL se ve el mes actual.
// - ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD: un rango elegido en el calendario,
//   con los dos extremos incluidos.
// - ?dias=N: los últimos N días hasta hoy. Ya no tiene atajo; se sigue leyendo
//   para que los links viejos anden.
import { shortDate, todayISO } from "./format";

const ISO_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

// Mes YYYY-MM corrido `back` meses hacia atrás.
function shiftMonth(month: string, back: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - back, 1));
  return d.toISOString().slice(0, 7);
}

const lastDayOf = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

// "octubre"
export const monthName = (month: string) =>
  new Date(`${month}-15T12:00:00Z`).toLocaleDateString("es-AR", { month: "long", timeZone: "UTC" });

// Los atajos del selector: los últimos tres meses, del más viejo al actual.
export function monthShortcuts(): { month: string; label: string }[] {
  const current = todayISO().slice(0, 7);
  return [2, 1, 0].map((back) => {
    const month = shiftMonth(current, back);
    const name = monthName(month);
    return { month, label: name.charAt(0).toUpperCase() + name.slice(1) };
  });
}

export function monthPeriod(month: string): Period {
  const today = todayISO();
  const since = `${month}-01`;
  const last = lastDayOf(month);
  const until = last < today ? last : today;
  // Uno de otro año lleva el año, para no confundirlo con el de este.
  const name = monthName(month);
  const label = month.slice(0, 4) === today.slice(0, 4) ? name : `${name} ${month.slice(0, 4)}`;
  return { since: since > until ? until : since, until, days: null, month, label };
}
// Meta guarda solo esta ventana (ver SYNC_DAYS en lib/meta-sync.ts).
export const META_HISTORY_DAYS = 90;
// El CRM trae las oportunidades abiertas y las cerradas de esta ventana (LEAD_DAYS
// en lib/kommo.ts y lib/odoo.ts): más atrás, faltan las cerradas.
export const CRM_HISTORY_DAYS = 95;
// Google Ads tiene todo el historial: se guarda el doble de 90 días para que el
// período más largo también se pueda comparar con el anterior (lib/google-ads-sync.ts).
export const GADS_HISTORY_DAYS = 182;

export type Period = {
  since: string;
  until: string;
  // Solo en "últimos N días" (?dias=).
  days: number | null;
  // YYYY-MM si es un mes calendario (?mes=); null en los demás.
  month?: string | null;
  // Para los subtítulos: "octubre", "últimos 30 días" o "del 1 sept al 15 sept".
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

// El período contra el que se compara. Un mes, con el mes anterior: entero si el
// mes ya terminó, y si es el actual, los mismos días (1 al 15 de octubre contra 1
// al 15 de septiembre), para no comparar medio mes con uno completo. Lo demás,
// con el tramo inmediatamente anterior del mismo largo.
export function previousPeriod(p: Period): Period {
  if (p.month) {
    const month = shiftMonth(p.month, 1);
    const full = monthPeriod(month);
    const partial = p.until < lastDayOf(p.month);
    const day = Math.min(Number(p.until.slice(8, 10)), Number(full.until.slice(8, 10)));
    const until = partial ? `${month}-${String(day).padStart(2, "0")}` : full.until;
    const label = partial ? `del ${shortDate(full.since)} al ${shortDate(until)}` : full.label;
    return { since: full.since, until, days: null, month: partial ? null : month, label };
  }
  const length = Math.round((Date.parse(`${p.until}T12:00:00Z`) - Date.parse(`${p.since}T12:00:00Z`)) / 86_400_000);
  const until = shiftDate(p.since, 1);
  const since = shiftDate(until, length);
  return { since, until, days: null, label: `del ${shortDate(since)} al ${shortDate(until)}` };
}

// Cómo nombrar ese período al lado del porcentaje: "vs. septiembre", "vs. 30 días anteriores".
export function versusLabel(p: Period) {
  if (p.month) {
    const previous = previousPeriod(p);
    return previous.month ? `vs. ${previous.label}` : `vs. mismos días de ${monthName(shiftMonth(p.month, 1))}`;
  }
  return p.days ? `vs. ${p.days} días anteriores` : "vs. período anterior";
}

// Cualquier otro valor en la URL cae en el mes actual.
export function readPeriod({
  mes,
  dias,
  desde,
  hasta,
}: {
  mes?: string;
  dias?: string;
  desde?: string;
  hasta?: string;
}): Period {
  if (desde && hasta && ISO_DATE.test(desde) && ISO_DATE.test(hasta)) return customPeriod(desde, hasta);
  if (mes && ISO_MONTH.test(mes) && mes <= todayISO().slice(0, 7)) return monthPeriod(mes);
  const days = Number(dias);
  if (Number.isInteger(days) && days > 0 && days <= 366) return lastDays(days);
  return monthPeriod(todayISO().slice(0, 7));
}

// Query string para llevar el mismo período a otra vista (p. ej. del CRM a META).
export const periodQuery = (p: Period) =>
  p.month ? `mes=${p.month}` : p.days ? `dias=${p.days}` : `desde=${p.since}&hasta=${p.until}`;

// Las funciones de datos aceptan un período o, como antes, una cantidad de días
// (el agente las sigue llamando así).
export const toPeriod = (p: Period | number) => (typeof p === "number" ? lastDays(p) : p);

// Para completar frases: "Ninguna venta {en octubre | en los últimos 30 días | del 1 sept al 15 sept}".
export const periodPhrase = (p: Period) => (p.month ? `en ${p.label}` : p.days ? `en los últimos ${p.days} días` : p.label);
