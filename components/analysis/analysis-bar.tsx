import Link from "next/link";
import { shortDate } from "@/lib/format";
import { getAnalyses } from "@/lib/analysis/store";
import type { Platform } from "@/lib/analysis/shared";
import { AnalyzeButton } from "./analyze-button";
import { Icon } from "../icons";

// Franja de "Analizar plataforma" arriba de las métricas (solo equipo): el botón y
// el estado del último análisis, con un link a sus recomendaciones. Quien la
// dibuja ya validó el área META.
export async function AnalysisBar({
  clientId,
  clientSlug,
  platform,
  period,
  periodLabel,
  href,
}: {
  clientId: string;
  clientSlug: string;
  platform: Platform;
  period: string;
  periodLabel: string;
  href: string;
}) {
  // Si falla (o faltan las tablas) el botón igual aparece: el error lo da el análisis.
  const last = (await getAnalyses(clientId, platform, 1).catch(() => null))?.[0];
  const pending = last?.recommendations.filter((r) => r.status === "pendiente").length ?? 0;

  return (
    <div className="card analysis-bar mb-4">
      <span className="analysis-bar-ico" aria-hidden>
        <Icon name="sparkles" size={18} />
      </span>
      <div className="analysis-bar-txt">
        <b>Análisis de la plataforma</b>
        {last ? (
          <span>
            Último: {shortDate(last.createdAt.slice(0, 10))} ·{" "}
            {pending ? `${pending} de ${last.recommendations.length} recomendaciones pendientes` : "todas las recomendaciones resueltas"}
            {" · "}
            <Link href={href}>Ver recomendaciones</Link>
          </span>
        ) : (
          <span>Claude revisa la configuración de la cuenta del período elegido y propone ajustes concretos.</span>
        )}
      </div>
      <AnalyzeButton clientSlug={clientSlug} platform={platform} period={period} periodLabel={periodLabel} resultHref={href} />
    </div>
  );
}
