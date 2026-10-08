"use server";

import { revalidatePath } from "next/cache";
import { getAreaSession } from "@/lib/auth";
import { getClient } from "@/lib/data";
import { type MilestoneInput, parseMilestone } from "@/lib/milestones-shared";
import { createClient, isMissingTable } from "@/lib/supabase/server";

export type MilestoneResult = { ok: true } | { ok: false; error: string };

const MISSING = "Falta correr docs/sql/2026-10-08-hitos.sql en Supabase.";

function failure(error: { code?: string }, what: string): MilestoneResult {
  if (isMissingTable(error)) return { ok: false, error: MISSING };
  console.error(`[hitos] ${what}`, error);
  return { ok: false, error: error.code === "42501" ? "No tenés permisos para esta acción." : `No se pudo ${what}.` };
}

// Solo el equipo con el área Clientes; la RLS lo vuelve a validar.
async function access(clientSlug: string) {
  const [session, client] = await Promise.all([getAreaSession("clientes"), getClient(clientSlug)]);
  return session && client ? { session, client } : null;
}

// Los hitos se ven en el Portal del cliente (equipo y cuenta del cliente).
function revalidate(slug: string) {
  revalidatePath(`/clientes/${slug}/portal`);
  revalidatePath("/mi-empresa/portal");
}

// Crea (sin id) o edita un hito.
export async function saveMilestone(clientSlug: string, id: string | null, input: MilestoneInput): Promise<MilestoneResult> {
  const ctx = await access(clientSlug);
  if (!ctx) return { ok: false, error: "No tenés acceso a este cliente." };

  const milestone = parseMilestone(input);
  if (typeof milestone === "string") return { ok: false, error: milestone };

  const supabase = await createClient();
  const now = new Date().toISOString();
  if (id) {
    const { data, error } = await supabase
      .from("intranet_client_milestones")
      .update({ ...milestone, updated_at: now })
      .eq("id", id)
      .eq("client_id", ctx.client.id)
      .select("id");
    if (error) return failure(error, "guardar el hito");
    if (!data?.length) return { ok: false, error: "El hito ya no existe." };
  } else {
    const { error } = await supabase
      .from("intranet_client_milestones")
      .insert({ ...milestone, client_id: ctx.client.id, created_by: ctx.session.user.id });
    if (error) return failure(error, "guardar el hito");
  }

  revalidate(ctx.client.slug);
  return { ok: true };
}

export async function deleteMilestone(clientSlug: string, id: string): Promise<MilestoneResult> {
  const ctx = await access(clientSlug);
  if (!ctx) return { ok: false, error: "No tenés acceso a este cliente." };

  const { error } = await (await createClient())
    .from("intranet_client_milestones")
    .delete()
    .eq("id", id)
    .eq("client_id", ctx.client.id);
  if (error) return failure(error, "borrar el hito");

  revalidate(ctx.client.slug);
  return { ok: true };
}
