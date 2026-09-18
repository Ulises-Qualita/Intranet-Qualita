// Lectura del foro (intranet_forum_posts / intranet_forum_comments). Solo server.
//
// Se lee con la sesión del usuario: la RLS deja ver todo al equipo activo, así que
// acá no hay que filtrar nada a mano. El modelo y las etiquetas viven en
// lib/forum-shared.ts, que también usan las pantallas de cliente.
import { getTeam } from "./data";
import type { Author, ForumComment, ForumKind, ForumStatus, ForumThread } from "./forum-shared";
import { createClient, isMissingTable } from "./supabase/server";

type PostRow = {
  id: string;
  author_id: string;
  kind: ForumKind;
  title: string;
  body: string;
  status: ForumStatus;
  // Opcional hasta que se corra la migración que la agrega.
  pinned?: boolean;
  created_at: string;
  updated_at: string;
};

type CommentRow = { id: string; post_id: string; author_id: string; body: string; created_at: string };

async function authors(): Promise<Map<string, Author>> {
  const team = await getTeam().catch(() => []);
  return new Map(team.map((m) => [m.id, { id: m.id, name: m.name, avatarUrl: m.avatarUrl }]));
}

const BASE_COLUMNS = "id, author_id, kind, title, body, status, created_at, updated_at";
// Se agregó después (docs/sql/2026-09-18-foro-fijado.sql). Mientras la base no la
// tenga, el foro se muestra igual sin mensajes fijados en vez de romper.
const COLUMN_MISSING = "42703";

// Mensajes con sus respuestas, en dos consultas y el cruce en memoria. Es un foro
// interno de un estudio: traerlo entero cuesta menos que pedir las respuestas de a
// una cada vez que alguien despliega un mensaje.
export async function getThreads(): Promise<{ threads: ForumThread[]; sinTabla: boolean }> {
  const supabase = await createClient();

  const readPosts = (conFijado: boolean) => {
    const query = supabase
      .from("intranet_forum_posts")
      .select(conFijado ? `${BASE_COLUMNS}, pinned` : BASE_COLUMNS);
    // Los fijados arriba y, dentro de cada grupo, los más nuevos primero.
    return (conFijado ? query.order("pinned", { ascending: false }) : query)
      .order("created_at", { ascending: false })
      .returns<PostRow[]>();
  };

  const [primera, { data: comments, error: commentsError }] = await Promise.all([
    readPosts(true),
    supabase
      .from("intranet_forum_comments")
      .select("id, post_id, author_id, body, created_at")
      .order("created_at", { ascending: true })
      .returns<CommentRow[]>(),
  ]);

  const { data: posts, error } =
    primera.error?.code === COLUMN_MISSING ? await readPosts(false) : primera;

  if (error || commentsError) {
    if (isMissingTable(error) || isMissingTable(commentsError)) return { threads: [], sinTabla: true };
    throw error ?? commentsError;
  }

  const byId = await authors();
  const byPost = new Map<string, ForumComment[]>();
  for (const { post_id, author_id, ...c } of comments ?? []) {
    const list = byPost.get(post_id) ?? [];
    list.push({ ...c, author: byId.get(author_id) ?? null });
    byPost.set(post_id, list);
  }

  return {
    sinTabla: false,
    threads: (posts ?? []).map(({ author_id, ...post }) => {
      const replies = byPost.get(post.id) ?? [];
      return {
        ...post,
        pinned: post.pinned ?? false,
        author: byId.get(author_id) ?? null,
        respuestas: replies.length,
        comments: replies,
      };
    }),
  };
}
