"use client";

// Estado de la conversación con el agente, compartido por la burbuja y /agente.
// Vive en app/(app)/layout.tsx, que no se desmonta al navegar: cerrar la burbuja,
// abrirla de nuevo o pasar a pantalla completa sigue en la misma conversación, y
// una respuesta a medio llegar sigue llegando aunque el panel esté cerrado.
// No sobrevive a recargar la página; para eso está el historial.
import { createContext, useCallback, useContext, useRef, useState } from "react";

export type ToolCall = { name: string; input: Record<string, unknown> };
export type Message = { role: "user" | "assistant"; content: string; tools: ToolCall[] };

// Qué mostrar mientras el agente consulta cada herramienta.
export const TOOL_LABELS: Record<string, string> = {
  listar_clientes: "Buscando en los clientes",
  tareas: "Revisando las tareas",
  meta_metricas: "Leyendo las métricas de Meta",
  meta_campanas: "Revisando las campañas de Meta",
  crm_resumen: "Leyendo el CRM",
  crm_leads: "Buscando oportunidades en el CRM",
  equipo: "Consultando el equipo",
};

type AgentState = {
  messages: Message[];
  threadId: string | null;
  title: string | null;
  busy: boolean;
  // Qué está haciendo el agente ahora mismo: el nombre de la tool o "pensando".
  activity: string | null;
  error: string | null;
  // Sube cada vez que se cambia de conversación (nueva, historial o adoptada).
  epoch: number;
  send: (question: string) => Promise<void>;
  reset: () => void;
  loadThread: (id: string, title: string) => Promise<void>;
  // Toma una conversación que ya llegó cargada (/agente?hilo=… desde el server).
  adopt: (id: string, title: string | null, messages: Message[]) => void;
};

const AgentContext = createContext<AgentState | null>(null);

export function useAgent() {
  const agent = useContext(AgentContext);
  if (!agent) throw new Error("useAgent va dentro de <AgentProvider>.");
  return agent;
}

export function AgentProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  // Cambiar de conversación a mitad de una respuesta la escribiría sobre la
  // conversación nueva: cada turno lleva un número y solo escribe el vigente.
  const turn = useRef(0);

  const send = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (!text || busy) return;

      const mine = ++turn.current;
      const live = () => turn.current === mine;

      setError(null);
      setBusy(true);
      setActivity("Pensando");
      setMessages((prev) => [...prev, { role: "user", content: text, tools: [] }, { role: "assistant", content: "", tools: [] }]);

      // Va acumulando sobre el último mensaje, que es el del asistente recién creado.
      const patch = (fn: (m: Message) => Message) => {
        if (live()) setMessages((prev) => prev.map((m, i) => (i === prev.length - 1 ? fn(m) : m)));
      };

      try {
        const res = await fetch("/api/agente", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, threadId }),
        });

        if (!res.ok || !res.body) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? "No se pudo conectar con Agente Q.");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        // SSE: eventos separados por línea en blanco, cada uno con su "data:".
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const chunks = buffer.split("\n\n");
          buffer = chunks.pop() ?? "";

          for (const chunk of chunks) {
            const line = chunk.split("\n").find((l) => l.startsWith("data: "));
            if (!line || !live()) continue;
            const event = JSON.parse(line.slice(6));

            if (event.type === "thread") {
              setThreadId(event.id);
              setTitle(event.title);
            }
            if (event.type === "tool") {
              setActivity(TOOL_LABELS[event.name] ?? "Consultando la intranet");
              patch((m) => ({ ...m, tools: [...m.tools, { name: event.name, input: {} }] }));
            }
            if (event.type === "thinking") setActivity("Pensando");
            if (event.type === "text") {
              setActivity(null);
              patch((m) => ({ ...m, content: m.content + event.text }));
            }
            if (event.type === "error") setError(event.message);
          }
        }
      } catch (e) {
        if (live()) setError(e instanceof Error ? e.message : "No se pudo completar la consulta.");
      } finally {
        if (live()) {
          setBusy(false);
          setActivity(null);
          // Un turno que terminó sin texto (error a mitad de camino) no deja una
          // burbuja vacía colgada.
          setMessages((prev) => prev.filter((m, i) => i !== prev.length - 1 || m.role !== "assistant" || m.content.trim()));
        }
      }
    },
    [busy, threadId],
  );

  // Suelta la respuesta en curso: se sigue recibiendo (el server la termina y la
  // guarda en su conversación) pero ya no se escribe en la que está en pantalla.
  const release = () => {
    turn.current++;
    setBusy(false);
    setActivity(null);
    setError(null);
    setEpoch((e) => e + 1);
  };

  const reset = useCallback(() => {
    release();
    setMessages([]);
    setThreadId(null);
    setTitle(null);
  }, []);

  const adopt = useCallback((id: string, threadTitle: string | null, initial: Message[]) => {
    release();
    setThreadId(id);
    setTitle(threadTitle);
    setMessages(initial);
  }, []);

  const loadThread = useCallback(
    async (id: string, threadTitle: string) => {
      const res = await fetch(`/api/agente?hilo=${id}`);
      const body = await res.json().catch(() => null);
      adopt(
        id,
        threadTitle,
        (body?.messages ?? []).map((m: Message) => ({ role: m.role, content: m.content, tools: m.tools ?? [] })),
      );
    },
    [adopt],
  );

  return (
    <AgentContext.Provider value={{ messages, threadId, title, busy, activity, error, epoch, send, reset, loadThread, adopt }}>
      {children}
    </AgentContext.Provider>
  );
}
