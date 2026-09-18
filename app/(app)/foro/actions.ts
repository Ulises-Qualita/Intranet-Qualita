"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { isForumKind, isForumStatus } from "@/lib/forum-shared";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true; error: null } | { ok: false; error: string };

const TITLE_MAX = 140;
const BODY_MAX = 4000;

// Perfil activo del equipo. Las políticas de la base exigen lo mismo; esto evita
// el viaje y devuelve un mensaje legible.
async function requireMember() {
  const session = await getSession();
  return session?.profile?.active ? session : null;
}

const text = (value: FormDataEntryValue | null) => (typeof value === "string" ? value.trim() : "");

export async function createPost(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const session = await requireMember();
  if (!session) return { ok: false, error: "Tu cuenta no está habilitada." };

  const title = text(form.get("title"));
  const body = text(form.get("body"));
  const kind = form.get("kind");

  if (!title) return { ok: false, error: "Escribí un título." };
  if (title.length > TITLE_MAX) return { ok: false, error: `El título no puede pasar de ${TITLE_MAX} caracteres.` };
  if (body.length > BODY_MAX) return { ok: false, error: `El detalle no puede pasar de ${BODY_MAX} caracteres.` };
  if (!isForumKind(kind)) return { ok: false, error: "Elegí de qué se trata." };

  const supabase = await createClient();
  const { error } = await supabase.from("intranet_forum_posts").insert({ author_id: session.user.id, kind, title, body });
  if (error) {
    console.error("[foro] createPost", error);
    return { ok: false, error: "No se pudo publicar el mensaje." };
  }

  revalidatePath("/foro");
  return { ok: true, error: null };
}

export async function addComment(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const session = await requireMember();
  if (!session) return { ok: false, error: "Tu cuenta no está habilitada." };

  const postId = text(form.get("postId"));
  const body = text(form.get("body"));
  if (!postId) return { ok: false, error: "Falta el mensaje." };
  if (!body) return { ok: false, error: "Escribí una respuesta." };
  if (body.length > BODY_MAX) return { ok: false, error: `La respuesta no puede pasar de ${BODY_MAX} caracteres.` };

  const supabase = await createClient();
  const { error } = await supabase.from("intranet_forum_comments").insert({ post_id: postId, author_id: session.user.id, body });
  if (error) {
    console.error("[foro] addComment", error);
    return { ok: false, error: "No se pudo publicar la respuesta." };
  }

  revalidatePath("/foro");
  return { ok: true, error: null };
}

// El estado lo mueve solo un admin. Se valida acá y, además, un trigger de la base
// lo vuelve a exigir: la interfaz no es la única puerta a la tabla.
export async function setStatus(postId: string, status: string): Promise<ActionResult> {
  const session = await requireMember();
  if (session?.profile?.role !== "admin") return { ok: false, error: "Solo un administrador puede cambiar el estado." };
  if (!isForumStatus(status)) return { ok: false, error: "Estado inválido." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("intranet_forum_posts")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", postId);
  if (error) {
    console.error("[foro] setStatus", error);
    return { ok: false, error: "No se pudo cambiar el estado." };
  }

  revalidatePath("/foro");
  return { ok: true, error: null };
}

// Fijar arriba de todo. Solo admin, igual que el estado, y con el mismo trigger
// respaldándolo del lado de la base.
export async function setPinned(postId: string, pinned: boolean): Promise<ActionResult> {
  const session = await requireMember();
  if (session?.profile?.role !== "admin") return { ok: false, error: "Solo un administrador puede fijar un mensaje." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("intranet_forum_posts")
    .update({ pinned, updated_at: new Date().toISOString() })
    .eq("id", postId);
  if (error) {
    console.error("[foro] setPinned", error);
    // La columna se agrega en una migración aparte de la de las tablas.
    return {
      ok: false,
      error:
        error.code === "42703" || error.code === "PGRST204"
          ? "Falta correr docs/sql/2026-09-18-foro-fijado.sql en Supabase."
          : "No se pudo fijar el mensaje.",
    };
  }

  revalidatePath("/foro");
  return { ok: true, error: null };
}

// La RLS decide si puede: el autor lo suyo, el admin cualquiera. Si no le
// corresponde, no borra ninguna fila y se avisa.
export async function deletePost(postId: string): Promise<ActionResult> {
  const session = await requireMember();
  if (!session) return { ok: false, error: "Tu cuenta no está habilitada." };

  const supabase = await createClient();
  const { data, error } = await supabase.from("intranet_forum_posts").delete().eq("id", postId).select("id");
  if (error || !data?.length) return { ok: false, error: "No se pudo borrar el mensaje." };

  revalidatePath("/foro");
  return { ok: true, error: null };
}

export async function deleteComment(commentId: string): Promise<ActionResult> {
  const session = await requireMember();
  if (!session) return { ok: false, error: "Tu cuenta no está habilitada." };

  const supabase = await createClient();
  const { data, error } = await supabase.from("intranet_forum_comments").delete().eq("id", commentId).select("id");
  if (error || !data?.length) return { ok: false, error: "No se pudo borrar la respuesta." };

  revalidatePath("/foro");
  return { ok: true, error: null };
}
