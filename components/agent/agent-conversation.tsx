"use client";

// La conversación con el agente: historial, log y campo de escritura. La usan las
// dos vistas — la burbuja flotante (`components/agent/agent-chat.tsx`) y la
// pantalla completa (`app/(app)/agente/page.tsx`) — con el mismo estado y las
// mismas llamadas; lo único que cambia es el ancho y qué trae la cabecera.
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { RichText } from "./rich-text";

type ToolCall = { name: string; input: Record<string, unknown> };
export type Message = { role: "user" | "assistant"; content: string; tools: ToolCall[] };
type Thread = { id: string; title: string; updated_at: string };

// Qué mostrar mientras el agente consulta cada herramienta.
const TOOL_LABELS: Record<string, string> = {
  listar_clientes: "Buscando en los clientes",
  tareas: "Revisando las tareas",
  meta_metricas: "Leyendo las métricas de Meta",
  meta_campanas: "Revisando las campañas de Meta",
  crm_resumen: "Leyendo el CRM",
  crm_leads: "Buscando oportunidades en el CRM",
  equipo: "Consultando el equipo",
};

const dateLabel = (iso: string) =>
  new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short" }).format(new Date(iso)).replace(".", "");

export function AgentConversation({
  userName,
  suggestions,
  variant,
  initialThreadId = null,
  initialMessages = [],
  initialTitle = null,
  onClose,
}: {
  userName: string;
  suggestions: string[];
  variant: "panel" | "page";
  // Conversación con la que se abre. Al pasar de la burbuja a pantalla completa,
  // /agente?hilo=… la lee en el server y llega renderizada, sin viaje extra.
  initialThreadId?: string | null;
  initialMessages?: Message[];
  initialTitle?: string | null;
  onClose?: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [threadId, setThreadId] = useState<string | null>(initialThreadId);
  const [title, setTitle] = useState<string | null>(initialTitle);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // Qué está haciendo el agente ahora mismo: el nombre de la tool o "pensando".
  const [activity, setActivity] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [threads, setThreads] = useState<Thread[] | null>(null);

  const scroller = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  async function loadThread(id: string, threadTitle: string) {
    setThreads(null);
    setError(null);
    setTitle(threadTitle);
    const res = await fetch(`/api/agente?hilo=${id}`);
    const body = await res.json().catch(() => null);
    setMessages(
      (body?.messages ?? []).map((m: { role: "user" | "assistant"; content: string; tools: ToolCall[] }) => ({
        role: m.role,
        content: m.content,
        tools: m.tools ?? [],
      })),
    );
    setThreadId(id);
  }

  // Cada respuesta que llega empuja el scroll al final, salvo que el usuario haya
  // subido a leer algo: ahí mandar el scroll abajo sería pelearle.
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    if (box.scrollHeight - box.scrollTop - box.clientHeight < 120) box.scrollTop = box.scrollHeight;
  }, [messages, activity]);

  useEffect(() => {
    field.current?.focus();
  }, []);

  const send = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (!text || busy) return;

      setInput("");
      setError(null);
      setBusy(true);
      setActivity("Pensando");
      setThreads(null);
      setMessages((prev) => [...prev, { role: "user", content: text, tools: [] }, { role: "assistant", content: "", tools: [] }]);

      // Va acumulando sobre el último mensaje, que es el del asistente recién creado.
      const patch = (fn: (m: Message) => Message) =>
        setMessages((prev) => prev.map((m, i) => (i === prev.length - 1 ? fn(m) : m)));

      try {
        const res = await fetch("/api/agente", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, threadId }),
        });

        if (!res.ok || !res.body) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? "No se pudo conectar con el agente.");
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
            if (!line) continue;
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
        setError(e instanceof Error ? e.message : "No se pudo completar la consulta.");
      } finally {
        setBusy(false);
        setActivity(null);
        // Un turno que terminó sin texto (error a mitad de camino) no deja una
        // burbuja vacía colgada.
        setMessages((prev) => prev.filter((m, i) => i !== prev.length - 1 || m.role !== "assistant" || m.content.trim()));
      }
    },
    [busy, threadId],
  );

  function reset() {
    setMessages([]);
    setThreadId(null);
    setTitle(null);
    setError(null);
    setThreads(null);
    field.current?.focus();
  }

  async function toggleHistory() {
    if (threads) return setThreads(null);
    const res = await fetch("/api/agente");
    const body = await res.json().catch(() => null);
    setThreads(body?.threads ?? []);
  }

  async function removeThread(id: string) {
    await fetch(`/api/agente?hilo=${id}`, { method: "DELETE" });
    setThreads((prev) => (prev ?? []).filter((t) => t.id !== id));
    if (id === threadId) reset();
  }

  return (
    <div className={`agent-conv ${variant}`}>
      <header className="agent-head">
        {variant === "panel" ? (
          <div className="agent-title">
            <Icon name="sparkles" size={16} />
            <h3>Agente</h3>
          </div>
        ) : (
          // En grande el título ya lo da la Topbar, así que acá va de qué se está
          // hablando: sin esto la cabecera queda con los botones flotando solos.
          <p className="agent-crumb">{title ?? "Nueva consulta"}</p>
        )}
        <div className="agent-actions">
          {variant === "panel" && (
            <Link
              href={threadId ? `/agente?hilo=${threadId}` : "/agente"}
              onClick={onClose}
              title="Abrir en pantalla completa"
              aria-label="Abrir en pantalla completa"
            >
              <Icon name="expand" size={16} />
            </Link>
          )}
          <button type="button" onClick={toggleHistory} title="Conversaciones anteriores">
            <Icon name="clock" size={16} />
          </button>
          <button type="button" onClick={reset} title="Nueva consulta" disabled={!messages.length && !threadId}>
            <Icon name="plus" size={16} />
          </button>
          {variant === "panel" && onClose && (
            <button type="button" onClick={onClose} title="Cerrar" aria-label="Cerrar el agente">
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
      </header>

      {threads && (
        <div className="agent-threads">
          {threads.length ? (
            threads.map((t) => (
              <div className="agent-thread" key={t.id}>
                <button type="button" onClick={() => loadThread(t.id, t.title)}>
                  <span>{t.title}</span>
                  <small>{dateLabel(t.updated_at)}</small>
                </button>
                <button type="button" className="agent-thread-del" onClick={() => removeThread(t.id)} title="Borrar">
                  <Icon name="close" size={13} />
                </button>
              </div>
            ))
          ) : (
            <p className="muted">Todavía no hay conversaciones guardadas.</p>
          )}
        </div>
      )}

      <div className="agent-log" ref={scroller}>
        <div className="agent-log-inner">
          {!messages.length ? (
            variant === "page" ? (
              // A pantalla completa el estado vacío es la pantalla entera: sin una
              // portada queda un panel enorme con una línea de texto arriba.
              <div className="agent-hero">
                <Image src="/Agente.png" alt="" width={72} height={72} priority />
                <h2>¿Qué querés saber, {userName.split(" ")[0]}?</h2>
                <p>Leo los clientes, el CRM, Meta y las tareas del estudio, en vivo. Preguntame con tus palabras.</p>
                <div className="agent-cards">
                  {suggestions.map((s) => (
                    <button type="button" key={s} onClick={() => send(s)}>
                      <span>{s}</span>
                      <Icon name="chevron" size={15} strokeWidth={2} />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="agent-empty">
                <p>Hola {userName.split(" ")[0]}. Preguntame lo que necesites sobre los clientes, el CRM, Meta o las tareas.</p>
                <div className="agent-chips">
                  {suggestions.map((s) => (
                    <button type="button" key={s} onClick={() => send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )
          ) : (
            messages.map((m, i) => (
              <div className={`agent-msg ${m.role}`} key={i}>
                {/* En grande las respuestas son largas: el isotipo a la izquierda
                    les da un ancla y separa un turno del siguiente. */}
                {variant === "page" && m.role === "assistant" && (
                  <Image className="agent-ava" src="/Agente.png" alt="" width={30} height={30} />
                )}
                <div className="agent-body">
                  {m.tools.length > 0 && (
                    <div className="agent-steps">
                      {m.tools.map((t, j) => (
                        <span key={j}>{TOOL_LABELS[t.name] ?? t.name}</span>
                      ))}
                    </div>
                  )}
                  {m.content ? <RichText>{m.content}</RichText> : null}
                </div>
              </div>
            ))
          )}

          {activity && (
            <div className="agent-activity">
              <i />
              {activity}…
            </div>
          )}
          {error && <p className="agent-error">{error}</p>}
        </div>
      </div>

      <form
        className="agent-composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <div className="agent-composer-inner">
          <textarea
            ref={field}
            value={input}
            rows={1}
            placeholder="Preguntá algo…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Enter manda, Shift+Enter hace salto de línea.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
          />
          <button type="submit" disabled={busy || !input.trim()} aria-label="Enviar">
            <Icon name="send" size={17} />
          </button>
        </div>
      </form>
    </div>
  );
}
