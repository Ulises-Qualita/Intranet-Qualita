import Link from "next/link";
import { Card, EmptyState } from "@/components/ui";
import { RichText } from "@/components/agent/rich-text";
import { getTeam } from "@/lib/data";
import { shortDate } from "@/lib/format";
import type { Platform } from "@/lib/analysis/shared";
import { PLATFORMS } from "@/lib/analysis/shared";
import { getAnalyses } from "@/lib/analysis/store";
import { featureEnabled } from "@/lib/features";
import { Icon } from "../icons";
import { RecommendationList } from "./recommendation-list";

// Pantalla de un análisis de plataforma (solo equipo, área META ya validada por la
// página): lectura general, lo que funciona y las recomendaciones para tildar. A
// la derecha, los análisis anteriores; ?id= abre uno de ellos.
export async function AnalysisView({
  clientId,
  platform,
  base,
  selected,
}: {
  clientId: string;
  platform: Platform;
  // Ruta de la pantalla: /clientes/[slug]/meta/analisis.
  base: string;
  selected?: string;
}) {
  const label = PLATFORMS.find((p) => p.id === platform)!.label;
  const back = base.replace(/\/analisis$/, "");
  const [analyses, team] = await Promise.all([getAnalyses(clientId, platform, 12), getTeam()]);
  const names = Object.fromEntries(team.map((m) => [m.id, m.name.split(" ")[0]]));

  const header = (
    <Link href={back} className="analysis-back">
      <Icon name="chevron" size={16} strokeWidth={2.2} />
      Volver a las métricas
    </Link>
  );

  if (!(await featureEnabled("platformAnalysis"))) {
    return (
      <section className="view">
        {header}
        <EmptyState label="Desactivada">
          El análisis de plataforma está desactivado. Un administrador lo puede activar en <b>Administración → Funciones en prueba</b>.
        </EmptyState>
      </section>
    );
  }

  if (analyses === null) {
    return (
      <section className="view">
        {header}
        <EmptyState label="Falta la base">
          Para guardar los análisis hay que correr <b>docs/sql/2026-10-15-analisis-plataforma.sql</b> en Supabase.
        </EmptyState>
      </section>
    );
  }

  const analysis = analyses.find((a) => a.id === selected) ?? analyses[0];
  if (!analysis) {
    return (
      <section className="view">
        {header}
        <EmptyState label="Sin análisis">
          Todavía no se analizó la cuenta de {label}. Usá <b>Analizar plataforma</b> en la solapa para generar el primero.
        </EmptyState>
      </section>
    );
  }

  const isLatest = analysis.id === analyses[0].id;
  const pending = analysis.recommendations.filter((r) => r.status === "pendiente").length;

  return (
    <section className="view">
      {header}
      <div className="grid g-2-1 analysis-grid">
        <div className="stack-cards">
          <Card
            title={`Análisis de ${label}`}
            hint={`${shortDate(analysis.since)} – ${shortDate(analysis.until)} · generado el ${shortDate(analysis.createdAt.slice(0, 10))}${
              analysis.createdBy && names[analysis.createdBy] ? ` por ${names[analysis.createdBy]}` : ""
            }`}
          >
            {!isLatest && <p className="hint-text">Estás viendo un análisis anterior.</p>}
            <div className="analysis-summary">
              <RichText>{analysis.summary}</RichText>
            </div>
            {analysis.strengths.length > 0 && (
              <div className="analysis-strengths">
                <h4>Lo que está funcionando</h4>
                <ul>
                  {analysis.strengths.map((s, i) => (
                    <li key={i}>
                      <Icon name="check" size={14} strokeWidth={2.4} />
                      <span>
                        <RichText>{s}</RichText>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          <Card
            title="Recomendaciones"
            hint={pending ? `${pending} de ${analysis.recommendations.length} pendientes` : "Todas resueltas"}
          >
            <RecommendationList recommendations={analysis.recommendations} names={names} path={base} />
          </Card>
        </div>

        <Card title="Análisis anteriores" hint={`${analyses.length}`}>
          <ul className="analysis-history">
            {analyses.map((a) => {
              const open = a.recommendations.filter((r) => r.status === "pendiente").length;
              return (
                <li key={a.id}>
                  <Link href={a.id === analyses[0].id ? base : `${base}?id=${a.id}`} className={a.id === analysis.id ? "on" : undefined}>
                    <b>{shortDate(a.createdAt.slice(0, 10))}</b>
                    <span>
                      {shortDate(a.since)} – {shortDate(a.until)} · {open ? `${open} pendientes` : "resuelto"}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </section>
  );
}
