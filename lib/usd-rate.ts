// Dólar oficial (venta, BNA) para pasar a pesos las ventas en dólares (objetivo de
// facturación de la Vista general). Solo server.
// - Hoy: dolarapi.com (se actualiza durante el día).
// - Un día anterior: argentinadatos.com, que guarda el histórico (también fines
//   de semana; si falta un día, se prueba con los anteriores).
import { unstable_cache } from "next/cache";
import { todayISO } from "./format";
import { shiftDate } from "./period";

export type UsdRate = { rate: number; date: string };

const venta = (raw: unknown): number | null => {
  const v = (raw as { venta?: unknown } | null)?.venta;
  return typeof v === "number" && v > 0 ? v : null;
};

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

const todayRate = unstable_cache(
  async (): Promise<UsdRate> => {
    const rate = venta(await fetchJson("https://dolarapi.com/v1/dolares/oficial"));
    if (!rate) throw new Error("dolarapi sin venta");
    return { rate, date: todayISO() };
  },
  ["usd-oficial-hoy"],
  { revalidate: 3600 },
);

// Un día pasado no cambia: se guarda un mes.
const pastRate = unstable_cache(
  async (date: string): Promise<UsdRate> => {
    for (let back = 0; back < 6; back++) {
      const day = shiftDate(date, back);
      const rate = venta(await fetchJson(`https://api.argentinadatos.com/v1/cotizaciones/dolares/oficial/${day.replaceAll("-", "/")}`).catch(() => null));
      if (rate) return { rate, date: day };
    }
    throw new Error(`sin cotización cerca del ${date}`);
  },
  ["usd-oficial-dia"],
  { revalidate: 30 * 86_400 },
);

// Cotización del día `date` (YYYY-MM-DD); null si no se pudo leer.
export async function getUsdRate(date: string): Promise<UsdRate | null> {
  try {
    return date >= todayISO() ? await todayRate() : await pastRate(date);
  } catch (e) {
    console.error("[usd-rate]", e);
    return null;
  }
}
