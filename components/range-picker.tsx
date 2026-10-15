import Link from "next/link";
import { type Period, monthShortcuts } from "@/lib/period";
import { CustomRange } from "./custom-range";

// Va en el topbar: los atajos de los últimos tres meses navegan con un link, y
// "Personalizado" abre un calendario para elegir desde y hasta. El período vive
// en la URL (ver lib/period.ts), sin estado en el cliente.
export function RangePicker({ basePath, period }: { basePath: string; period: Period }) {
  return (
    <div className="range">
      {monthShortcuts().map((m) => (
        <Link key={m.month} href={`${basePath}?mes=${m.month}`} className={m.month === period.month ? "on" : undefined}>
          {m.label}
        </Link>
      ))}
      <CustomRange basePath={basePath} period={period} />
    </div>
  );
}
