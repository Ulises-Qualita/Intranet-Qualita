"use server";

import { revalidatePath } from "next/cache";
import { getAreaSession } from "@/lib/auth";
import { getClientMeetings } from "@/lib/calendar";
import { getClient } from "@/lib/data";
import { MEETING_NOTE_MAX } from "@/lib/meeting-notes";
import { createClient, isMissingTable } from "@/lib/supabase/server";

export type NoteResult = { ok: true } | { ok: false; error: string };

// Guarda (o borra, si queda vacía) la descripción de una reunión ya hecha. Solo
// el equipo; la RLS lo vuelve a validar. La clave tiene que ser de una reunión
// pasada de ese cliente: no se guardan notas sueltas.
export async function saveMeetingNote(clientSlug: string, meetingKey: string, text: string): Promise<NoteResult> {
  const [session, client] = await Promise.all([getAreaSession("clientes"), getClient(clientSlug)]);
  if (!session || !client) return { ok: false, error: "No tenés acceso a este cliente." };

  const notes = String(text ?? "").trim();
  if (notes.length > MEETING_NOTE_MAX) return { ok: false, error: `Máximo ${MEETING_NOTE_MAX} caracteres.` };

  const { past, error: calendarError } = await getClientMeetings(client.name);
  if (calendarError) return { ok: false, error: "No se pudo leer Google Calendar para validar la reunión." };
  if (!past.some((m) => m.key === meetingKey)) return { ok: false, error: "La reunión no existe o todavía no pasó." };

  const supabase = await createClient();
  const { error } = notes
    ? await supabase.from("intranet_meeting_notes").upsert({
        client_id: client.id,
        meeting_key: meetingKey,
        notes,
        updated_by: session.user.id,
        updated_at: new Date().toISOString(),
      })
    : await supabase.from("intranet_meeting_notes").delete().eq("client_id", client.id).eq("meeting_key", meetingKey);

  if (error) {
    if (isMissingTable(error)) return { ok: false, error: "Falta correr docs/sql/2026-09-30-reuniones-notas.sql en Supabase." };
    console.error("[reuniones] guardar nota", client.id, error);
    return { ok: false, error: error.code === "42501" ? "No tenés permisos para esta acción." : "No se pudo guardar." };
  }

  revalidatePath(`/clientes/${client.slug}/reuniones`);
  return { ok: true };
}
