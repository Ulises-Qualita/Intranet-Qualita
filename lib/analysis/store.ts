// Análisis de plataforma guardados y sus recomendaciones. Solo server: lee y
// escribe con la sesión del usuario (RLS: equipo con el área META o admin).
import { createClient, isMissingTable } from "../supabase/server";
import type { Analysis, AnalysisResult, Platform, Recommendation, RecStatus } from "./shared";
import { targetLabel } from "./shared";

type AnalysisRow = {
  id: string;
  platform: Platform;
  since: string;
  until: string;
  summary: string;
  strengths: unknown;
  model: string | null;
  created_by: string | null;
  created_at: string;
  intranet_platform_recommendations: {
    id: string;
    position: number;
    priority: Recommendation["priority"];
    effort: Recommendation["effort"];
    category: string;
    title: string;
    target: string;
    action: string;
    reason: string;
    impact: string;
    status: RecStatus;
    status_by: string | null;
    status_at: string | null;
  }[];
};

const toAnalysis = (r: AnalysisRow): Analysis => ({
  id: r.id,
  platform: r.platform,
  since: r.since,
  until: r.until,
  summary: r.summary,
  strengths: Array.isArray(r.strengths) ? r.strengths.filter((s): s is string => typeof s === "string") : [],
  model: r.model,
  createdBy: r.created_by,
  createdAt: r.created_at,
  recommendations: [...r.intranet_platform_recommendations]
    .sort((a, b) => a.position - b.position)
    .map((x) => ({
      id: x.id,
      position: x.position,
      priority: x.priority,
      effort: x.effort,
      category: x.category,
      title: x.title,
      target: x.target,
      action: x.action,
      reason: x.reason,
      impact: x.impact,
      status: x.status,
      statusBy: x.status_by,
      statusAt: x.status_at,
    })),
});

// Los últimos análisis del cliente en la plataforma, del más nuevo al más viejo.
// null si las tablas todavía no existen.
export async function getAnalyses(clientId: string, platform: Platform, limit = 10): Promise<Analysis[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("intranet_platform_analyses")
    .select(
      "id, platform, since, until, summary, strengths, model, created_by, created_at, intranet_platform_recommendations(id, position, priority, effort, category, title, target, action, reason, impact, status, status_by, status_at)",
    )
    .eq("client_id", clientId)
    .eq("platform", platform)
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<AnalysisRow[]>();
  if (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  return (data ?? []).map(toAnalysis);
}

export async function saveAnalysis(
  clientId: string,
  platform: Platform,
  period: { since: string; until: string },
  result: AnalysisResult,
  model: string,
  userId: string,
): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("intranet_platform_analyses")
    .insert({
      client_id: clientId,
      platform,
      since: period.since,
      until: period.until,
      summary: result.summary,
      strengths: result.strengths,
      model,
      created_by: userId,
    })
    .select("id")
    .single<{ id: string }>();
  if (error) throw error;

  if (result.recommendations.length) {
    const { error: recError } = await supabase.from("intranet_platform_recommendations").insert(
      result.recommendations.map((r, i) => ({
        analysis_id: data.id,
        client_id: clientId,
        position: i,
        priority: r.priority,
        effort: r.effort,
        category: r.category,
        title: r.title,
        target: targetLabel(r.targetLevel, r.targetName),
        action: r.action,
        reason: r.reason,
        impact: r.impact,
      })),
    );
    if (recError) {
      // Sin recomendaciones el análisis no sirve: se borra y se informa el error.
      await supabase.from("intranet_platform_analyses").delete().eq("id", data.id);
      throw recError;
    }
  }
  return data.id;
}

// Lo que se recomendó la vez anterior y qué se hizo, para que Claude haga el seguimiento.
export function followUpContext(previous: Analysis | undefined) {
  if (!previous) return undefined;
  return {
    fecha: previous.createdAt.slice(0, 10),
    periodo: { desde: previous.since, hasta: previous.until },
    recomendaciones: previous.recommendations.map((r) => ({
      titulo: r.title,
      donde: r.target,
      accion: r.action,
      estado: r.status,
      cambiadoEl: r.statusAt?.slice(0, 10) ?? undefined,
    })),
  };
}
