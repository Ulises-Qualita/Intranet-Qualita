// Generación de un análisis de plataforma, paso a paso. Solo server. La usa el
// endpoint SSE (app/api/analisis/route.ts), que va mostrando cada paso en un modal.
import type { Client } from "../data";
import type { Period } from "../period";
import { criteriaBlocks } from "../ad-criteria";
import { isMissingTable } from "../supabase/server";
import { analyzeWithClaude } from "./ai";
import { buildGadsContext } from "./gads-data";
import { AnalysisDataError, buildMetaContext } from "./meta-data";
import type { AnalysisResult, Platform } from "./shared";
import { followUpContext, getAnalyses, saveAnalysis } from "./store";

// Error con un mensaje para mostrar tal cual en la pantalla.
export class AnalysisError extends Error {}

export type AnalysisStep = "datos" | "claude" | "guardar";

export type AnalysisProgress = { step: (step: AnalysisStep) => void };

const normalize = (s: string) => s.trim().replace(/\s+/g, " ").toUpperCase();

// Una recomendación que nombra algo que no está en la cuenta (Claude lo escribió
// mal o lo inventó) no se puede aplicar y se descarta: así nunca queda apuntando a
// una campaña que no existe.
function checkTargets(result: AnalysisResult, targets: Set<string>): AnalysisResult {
  const known = new Map([...targets].map((t) => [normalize(t), t]));
  return {
    ...result,
    recommendations: result.recommendations.flatMap((r) => {
      if (r.targetLevel === "cuenta") return [{ ...r, targetName: "" }];
      const exact = known.get(normalize(r.targetName));
      if (exact) return [{ ...r, targetName: exact }];
      console.warn("[analisis] recomendación con destino desconocido:", r.targetLevel, r.targetName);
      return [];
    }),
  };
}

// Quien la llama ya validó el acceso (área META) y resolvió el cliente con la RLS.
export async function generateAnalysis(
  client: Client,
  platform: Platform,
  period: Period,
  user: { id: string; seesCrm: boolean },
  progress: AnalysisProgress,
): Promise<{ id: string; dropped: number }> {
  const isMeta = platform === "meta";
  if (isMeta && !client.conn.meta) throw new AnalysisError("El cliente no tiene Meta conectado.");
  if (!isMeta && !client.conn.google_ads) throw new AnalysisError("El cliente no tiene Google Ads conectado.");

  // El análisis anterior: sirve para el seguimiento y para saber si están las tablas.
  const previous = await getAnalyses(client.id, platform, 1);
  if (previous === null) throw new AnalysisError("Falta crear las tablas del análisis (docs/sql/2026-10-15-analisis-plataforma.sql).");

  progress.step("datos");
  const { context, targets } = await (isMeta ? buildMetaContext(client, period, user.seesCrm) : buildGadsContext(client, period)).catch((e) => {
    if (e instanceof AnalysisDataError) throw new AnalysisError(e.message);
    console.error("[analisis] datos", client.id, e);
    throw new AnalysisError(`No se pudo leer la cuenta de ${isMeta ? "Meta" : "Google Ads"}. Probá de nuevo en un rato.`);
  });
  const followUp = followUpContext(previous[0]);
  // Lo que cargó la agencia en Administración → Criterio de pauta.
  const { blocks: criteria } = await criteriaBlocks(platform);

  progress.step("claude");
  const { result, model } = await analyzeWithClaude(platform, followUp ? { ...context, analisisAnterior: followUp } : context, user.id, criteria).catch((e) => {
    console.error("[analisis] claude", client.id, e);
    throw new AnalysisError(e instanceof Error ? e.message : "Claude no pudo analizar la cuenta.");
  });
  const checked = checkTargets(result, targets);
  if (!checked.recommendations.length) throw new AnalysisError("Claude no devolvió recomendaciones que se puedan aplicar. Probá de nuevo.");

  progress.step("guardar");
  const id = await saveAnalysis(client.id, platform, period, checked, model, user.id).catch((e) => {
    console.error("[analisis] guardar", client.id, e);
    throw new AnalysisError(
      isMissingTable(e) ? "Falta crear las tablas del análisis (docs/sql/2026-10-15-analisis-plataforma.sql)." : "No se pudo guardar el análisis.",
    );
  });
  return { id, dropped: result.recommendations.length - checked.recommendations.length };
}
