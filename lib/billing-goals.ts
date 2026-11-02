// Objetivo de facturación por cliente (intranet_clients.billing_goals): un monto en
// pesos por mes, cargado a mano por el equipo. Un mes sin objetivo propio hereda el
// del último mes cargado antes. Sin imports de server: lo usa también el editor.

export type BillingGoals = Record<string, number>;

const ISO_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export const BILLING_GOAL_MAX = 1e13;

export function parseBillingGoals(raw: unknown): BillingGoals {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const goals: BillingGoals = {};
  for (const [month, value] of Object.entries(raw)) {
    if (ISO_MONTH.test(month) && typeof value === "number" && Number.isFinite(value) && value > 0) goals[month] = value;
  }
  return goals;
}

// El objetivo vigente en `month` y de qué mes viene (el mismo o uno anterior).
export function goalFor(goals: BillingGoals, month: string): { amount: number; from: string } | null {
  const from = Object.keys(goals)
    .filter((m) => m <= month)
    .sort()
    .pop();
  return from ? { amount: goals[from], from } : null;
}

// "5.000.000", "$ 5000000" o "5000000,50" → 5000000 (sin centavos). Vacío = null.
export function parseAmount(text: string): number | null | "invalid" {
  const clean = text.replace(/[$\s]/g, "");
  if (!clean) return null;
  if (!/^\d{1,3}(\.\d{3})*(,\d+)?$|^\d+(,\d+)?$/.test(clean)) return "invalid";
  const value = Math.round(Number(clean.replace(/\./g, "").replace(",", ".")));
  return value > 0 && value < BILLING_GOAL_MAX ? value : "invalid";
}
