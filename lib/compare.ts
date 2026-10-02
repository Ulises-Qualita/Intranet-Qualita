// Comparación de una métrica contra el período anterior. Sin imports de server:
// lo calculan las vistas y lo dibuja Kpi (components/ui.tsx).
import { percent } from "./format";

// Qué es mejorar para cada métrica: subir (leads, CTR), bajar (CPL, CPM) o
// ninguna de las dos (gasto: gastar más no es ni bueno ni malo).
export type Better = "up" | "down" | "neutral";

export type Change = {
  // Hacia dónde se movió el número.
  dir: "up" | "down" | "flat";
  // Cómo se pinta: "up" verde (mejoró), "down" rojo (empeoró), "flat" gris.
  tone: "up" | "down" | "flat";
  // "12%", "0,4%".
  label: string;
  // Para el title: el valor del período anterior y sus fechas.
  detail: string;
};

// Por debajo de esto se considera que no cambió.
const FLAT_PCT = 0.5;

// null cuando no hay contra qué comparar: sin dato actual, o con el anterior en
// cero o ausente (un porcentaje sobre cero no dice nada).
export function compare(
  current: number | null,
  previous: number | null,
  { better, format, versus }: { better: Better; format: (value: number) => string; versus: string },
): Change | null {
  if (current === null || previous === null || !Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) {
    return null;
  }
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const dir = Math.abs(pct) < FLAT_PCT ? "flat" : pct > 0 ? "up" : "down";
  const improved = better === "up" ? dir === "up" : dir === "down";
  return {
    dir,
    tone: dir === "flat" || better === "neutral" ? "flat" : improved ? "up" : "down",
    label: percent(Math.abs(pct), Math.abs(pct) < 10 ? 1 : 0),
    detail: `${versus}: ${format(previous)}`,
  };
}
