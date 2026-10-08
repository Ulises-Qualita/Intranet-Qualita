// Hitos de un cliente (intranet_client_milestones). Solo server. Se leen con la
// sesión: la RLS deja al equipo leer y escribir, y a la cuenta del cliente solo
// leer los de su empresa.
import { isMilestoneKind, type Milestone } from "./milestones-shared";
import { createClient, isMissingTable } from "./supabase/server";

export type MilestonesResult = {
  // Por fecha; en el mismo día, el inicio primero y después por orden de carga.
  milestones: Milestone[];
  // Falta correr docs/sql/2026-10-08-hitos.sql.
  missingTable: boolean;
};

type Row = { id: string; kind: string; title: string; description: string | null; date: string };

export async function getMilestones(clientId: string): Promise<MilestonesResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("intranet_client_milestones")
    .select("id, kind, title, description, date")
    .eq("client_id", clientId)
    .order("date", { ascending: true })
    .order("created_at", { ascending: true })
    .returns<Row[]>();
  if (error) {
    if (!isMissingTable(error)) console.error("[hitos]", clientId, error);
    return { milestones: [], missingTable: isMissingTable(error) };
  }

  const milestones = (data ?? []).map((r): Milestone => ({ ...r, kind: isMilestoneKind(r.kind) ? r.kind : "hito" }));
  // sort es estable: solo sube el inicio dentro de su mismo día.
  milestones.sort((a, b) => a.date.localeCompare(b.date) || Number(b.kind === "inicio") - Number(a.kind === "inicio"));
  return { milestones, missingTable: false };
}
