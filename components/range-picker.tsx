import Link from "next/link";
import { type Period, RANGES } from "@/lib/period";
import { CustomRange } from "./custom-range";

// Va en el topbar: los atajos de 7 / 30 / 90 días navegan con un link, y
// "Personalizado" abre un calendario para elegir desde y hasta. El período vive
// en la URL (ver lib/period.ts), sin estado en el cliente.
export function RangePicker({ basePath, period }: { basePath: string; period: Period }) {
  return (
    <div className="range">
      {RANGES.map((r) => (
        <Link key={r} href={`${basePath}?dias=${r}`} className={r === period.days ? "on" : undefined}>
          {r} días
        </Link>
      ))}
      <CustomRange basePath={basePath} period={period} />
    </div>
  );
}
