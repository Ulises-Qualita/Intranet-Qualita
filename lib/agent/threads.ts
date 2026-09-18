// Historial de conversaciones del agente (intranet_agent_threads / _messages).
// Solo server. Usa la sesión del usuario: la RLS deja ver únicamente los hilos
// propios, así que acá no hace falta filtrar por user_id al leer.
//
// Se guarda solo el texto de cada turno, nunca lo que devolvieron las tools: los
// datos de clientes ya viven en sus tablas y duplicarlos en un log de chat sería
// guardarlos de más, con una copia que además envejece.
import { createClient, isMissingTable } from "../supabase/server";

// Turnos que se le mandan al modelo al retomar una conversación. Más atrás que
// esto, el contexto aporta poco y cuesta tokens en cada pregunta.
const HISTORY_TURNS = 20;

// Qué herramienta llamó el agente en un turno; se muestra al retomar el hilo.
export type ToolCall = { name: string; input: Record<string, unknown> };

export type AgentMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  tools: ToolCall[];
  created_at: string;
};

export type AgentThread = { id: string; title: string; updated_at: string };

// Las tablas pueden no existir todavía (falta correr docs/sql/2026-09-18-agente.sql).
// El chat tiene que andar igual, sin historial, en vez de romper.

export async function listThreads(limit = 30): Promise<AgentThread[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("intranet_agent_threads")
    .select("id, title, updated_at")
    .order("updated_at", { ascending: false })
    .limit(limit)
    .returns<AgentThread[]>();
  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  return data ?? [];
}

// Una conversación por id, para poder titular la pantalla al retomarla. La RLS
// filtra por dueño: un id ajeno devuelve null.
export async function getThread(threadId: string): Promise<AgentThread | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("intranet_agent_threads")
    .select("id, title, updated_at")
    .eq("id", threadId)
    .maybeSingle<AgentThread>();
  if (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  return data;
}

export async function getMessages(threadId: string): Promise<AgentMessage[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("intranet_agent_messages")
    .select("id, role, content, tools, created_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
    .returns<AgentMessage[]>();
  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  return data ?? [];
}

// Título del hilo: la primera pregunta, recortada en un espacio para no cortar
// una palabra al medio.
function titleFrom(question: string) {
  const clean = question.replace(/\s+/g, " ").trim();
  if (clean.length <= 60) return clean || "Nueva consulta";
  const cut = clean.slice(0, 60);
  const space = cut.lastIndexOf(" ");
  return `${space > 30 ? cut.slice(0, space) : cut}…`;
}

// Crea el hilo si es la primera pregunta; si ya existe, solo lo marca como usado.
// Devuelve null si la tabla todavía no está creada: el chat sigue andando sin
// guardar nada.
export async function openThread(threadId: string | null, question: string, userId: string): Promise<AgentThread | null> {
  const supabase = await createClient();

  if (threadId) {
    const { data, error } = await supabase
      .from("intranet_agent_threads")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", threadId)
      .select("id, title, updated_at")
      .maybeSingle<AgentThread>();
    if (error && !isMissingTable(error)) throw error;
    // La RLS filtra por dueño: un id de otro usuario no devuelve fila y se abre
    // un hilo nuevo en vez de escribir en el ajeno.
    if (data) return data;
  }

  const { data, error } = await supabase
    .from("intranet_agent_threads")
    .insert({ user_id: userId, title: titleFrom(question) })
    .select("id, title, updated_at")
    .single<AgentThread>();
  if (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  return data;
}

export async function saveMessage(threadId: string, role: "user" | "assistant", content: string, tools: ToolCall[] = []) {
  const supabase = await createClient();
  const { error } = await supabase.from("intranet_agent_messages").insert({ thread_id: threadId, role, content, tools });
  if (error && !isMissingTable(error)) throw error;
}

// Historial para mandarle al modelo: solo texto. Los mensajes vacíos (un turno
// que terminó sin texto) se descartan porque la API los rechaza, y si el corte de
// los últimos turnos arranca en una respuesta del asistente se la saltea: el
// primer mensaje tiene que ser del usuario.
export async function history(threadId: string) {
  const messages = await getMessages(threadId);
  const recent = messages.filter((m) => m.content.trim()).slice(-HISTORY_TURNS);
  const first = recent.findIndex((m) => m.role === "user");
  return first === -1 ? [] : recent.slice(first).map((m) => ({ role: m.role, content: m.content }));
}

export async function deleteThread(threadId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("intranet_agent_threads").delete().eq("id", threadId);
  if (error && !isMissingTable(error)) throw error;
}
