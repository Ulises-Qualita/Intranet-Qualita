// Descripción de las reuniones ya hechas (intranet_meeting_notes). Solo server.
// Se lee con la sesión: la RLS deja al equipo leer y escribir, y a la cuenta del
// cliente solo leer las de su empresa.
import { createClient, isMissingTable } from "./supabase/server";

export type MeetingNote = { notes: string; updatedAt: string; updatedBy: string | null };

export type MeetingNotes = {
  byKey: Record<string, MeetingNote>;
  // Falta correr docs/sql/2026-09-30-reuniones-notas.sql.
  missingTable: boolean;
};

export async function getMeetingNotes(clientId: string): Promise<MeetingNotes> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("intranet_meeting_notes")
    .select("meeting_key, notes, updated_at, updated_by")
    .eq("client_id", clientId)
    .returns<{ meeting_key: string; notes: string; updated_at: string; updated_by: string | null }[]>();
  if (error) {
    if (!isMissingTable(error)) console.error("[reuniones] notas", clientId, error);
    return { byKey: {}, missingTable: isMissingTable(error) };
  }
  return {
    byKey: Object.fromEntries(
      (data ?? []).map((r) => [r.meeting_key, { notes: r.notes, updatedAt: r.updated_at, updatedBy: r.updated_by }]),
    ),
    missingTable: false,
  };
}

export const MEETING_NOTE_MAX = 4000;
