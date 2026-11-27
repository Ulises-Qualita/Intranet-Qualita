"use server";

import { revalidatePath } from "next/cache";
import { getAreaSession } from "@/lib/auth";
import { BrainMeetingsError, getRecordedMeetings } from "@/lib/brain-meetings";
import { type MeetingInsights, type RecordedMeeting, parseInsights } from "@/lib/brain-meetings-shared";
import { brainArea } from "@/lib/brains";
import { getInternalClient } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/server";

// Reuniones de los cerebros de área. La tabla no tiene políticas: se valida acá
// (equipo activo con el área clientes) y se escribe con service_role.

export type BrainResult = { ok: true; error: null } | { ok: false; error: string };

const TABLE = "intranet_brain_meetings";
const NO_ACCESS = { ok: false, error: "No tenés acceso a los cerebros." } as const;
const MISSING = { ok: false, error: "Falta correr docs/sql/2026-11-26-cerebros-reuniones.sql en Supabase." } as const;

async function requireTeam() {
  const session = await getAreaSession("clientes");
  return session?.profile?.active ? session : null;
}

async function revalidateArea(area: string) {
  const internal = await getInternalClient();
  if (internal) revalidatePath(`/clientes/${internal.slug}/cerebros/${area}`);
}

// Reuniones grabadas del calendario de quien entra, para elegir cuál cargar.
export async function listRecordedMeetings(
  area: string,
): Promise<{ ok: true; meetings: RecordedMeeting[] } | { ok: false; error: string }> {
  const session = await requireTeam();
  if (!session) return NO_ACCESS;
  if (!brainArea(area)) return { ok: false, error: "Área no encontrada." };
  try {
    return { ok: true, meetings: await getRecordedMeetings(session.user.email, area) };
  } catch (e) {
    if (!(e instanceof BrainMeetingsError)) console.error("[cerebros] calendario", e);
    return { ok: false, error: e instanceof Error ? e.message : "No se pudo leer el calendario." };
  }
}

// Confirma un borrador con lo que el equipo corrigió en la revisión.
export async function saveBrainMeeting(
  id: string,
  input: { title: string; metOn: string | null; insights: MeetingInsights },
): Promise<BrainResult> {
  if (!(await requireTeam())) return NO_ACCESS;
  const title = String(input.title ?? "").trim().replace(/\s+/g, " ").slice(0, 200);
  if (!title) return { ok: false, error: "Poné un título." };
  const metOn = input.metOn && /^\d{4}-\d{2}-\d{2}$/.test(input.metOn) ? input.metOn : null;
  const insights = parseInsights(input.insights);
  insights.learnings = insights.learnings
    .map((l) => ({ title: l.title.slice(0, 120), detail: l.detail.slice(0, 1000) }))
    .filter((l) => l.detail)
    .slice(0, 60);
  if (!insights.learnings.length) return { ok: false, error: "Dejá al menos un criterio o aprendizaje." };

  const db = createAdminClient();
  const { data, error } = await db
    .from(TABLE)
    .update({ title, met_on: metOn, insights, status: "guardada", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "borrador")
    .select("area")
    .maybeSingle<{ area: string }>();
  if (error) {
    if (error.code === "PGRST205") return MISSING;
    console.error("[cerebros] guardar", error);
    return { ok: false, error: "No se pudo guardar la reunión." };
  }
  if (!data) return { ok: false, error: "Ese borrador ya no existe. Volvé a cargar la reunión." };
  await revalidateArea(data.area);
  return { ok: true, error: null };
}

// Cancelar la revisión: el borrador se borra.
export async function discardBrainMeeting(id: string): Promise<BrainResult> {
  if (!(await requireTeam())) return NO_ACCESS;
  await createAdminClient().from(TABLE).delete().eq("id", id).eq("status", "borrador");
  return { ok: true, error: null };
}

export async function deleteBrainMeeting(id: string): Promise<BrainResult> {
  if (!(await requireTeam())) return NO_ACCESS;
  const { data, error } = await createAdminClient().from(TABLE).delete().eq("id", id).select("area").maybeSingle<{ area: string }>();
  if (error) {
    if (error.code === "PGRST205") return MISSING;
    console.error("[cerebros] borrar", error);
    return { ok: false, error: "No se pudo borrar la reunión." };
  }
  if (data) await revalidateArea(data.area);
  return { ok: true, error: null };
}
