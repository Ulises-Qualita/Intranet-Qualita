import Link from "next/link";

// Períodos que ofrecen las vistas de métricas. El sync guarda 90 días.
export const RANGES = [7, 30, 90] as const;
export const DEFAULT_RANGE = 30;

// Lee ?dias= de la URL y descarta cualquier otro valor.
export const readRange = (dias: string | undefined) => RANGES.find((r) => String(r) === dias) ?? DEFAULT_RANGE;

// Va en el topbar: cambia el período navegando, sin estado en el cliente.
export function RangePicker({ basePath, days }: { basePath: string; days: number }) {
  return (
    <div className="range">
      {RANGES.map((r) => (
        <Link key={r} href={`${basePath}?dias=${r}`} className={r === days ? "on" : undefined}>
          {r} días
        </Link>
      ))}
    </div>
  );
}
