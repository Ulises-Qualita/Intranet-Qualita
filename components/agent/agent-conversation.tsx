"use client";

// La conversación con el agente: historial, log y campo de escritura. La usan las
// dos vistas — la burbuja flotante (`components/agent/agent-chat.tsx`) y la
// pantalla completa (`app/(app)/agente/page.tsx`) — sobre el mismo estado, que
// vive en `agent-store.tsx`; lo único que cambia es el ancho y qué trae la cabecera.
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { TOOL_LABELS, useAgent, type Message } from "./agent-store";
import { RichText } from "./rich-text";

type Thread = { id: string; title: string; updated_at: string };

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
  // Conversación con la que se abre /agente?hilo=…: el server la lee y llega
  // renderizada. Sin hilo, se sigue la que esté abierta en la burbuja.
  initialThreadId?: string | null;
  initialMessages?: Message[];
  initialTitle?: string | null;
  onClose?: () => void;
}) {
  const agent = useAgent();
  const [input, setInput] = useState("");
  const [threads, setThreads] = useState<Thread[] | null>(null);

  // Si el hilo del URL no es el que ya está abierto (p. ej. al recargar), se lo
  // adopta. Hasta que el provider lo tome (sube su epoch) se muestra lo que trajo
  // el server, así no parpadea el estado vacío.
  const [adopting] = useState(() =>
    initialThreadId && initialThreadId !== agent.threadId && !agent.busy ? { from: agent.epoch } : null,
  );
  const pending = adopting !== null && agent.epoch === adopting.from;
  useEffect(() => {
    if (adopting && initialThreadId) agent.adopt(initialThreadId, initialTitle, initialMessages);
    // Solo al montar: después la conversación la maneja el provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const messages = pending ? initialMessages : agent.messages;
  const threadId = pending ? initialThreadId : agent.threadId;
  const title = pending ? initialTitle : agent.title;
  const { busy, activity, error } = agent;

  const scroller = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  // Cada respuesta que llega empuja el scroll al final, salvo que el usuario haya
  // subido a leer algo: ahí mandar el scroll abajo sería pelearle.
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    if (box.scrollHeight - box.scrollTop - box.clientHeight < 120) box.scrollTop = box.scrollHeight;
  }, [messages, activity]);

  // Al abrir, la conversación retomada arranca desde el último mensaje.
  useEffect(() => {
    const box = scroller.current;
    if (box) box.scrollTop = box.scrollHeight;
    field.current?.focus();
  }, []);

  function send(question: string) {
    if (!question.trim() || busy) return;
    setInput("");
    setThreads(null);
    agent.send(question);
  }

  function reset() {
    agent.reset();
    setThreads(null);
    field.current?.focus();
  }

  async function loadThread(id: string, threadTitle: string) {
    setThreads(null);
    await agent.loadThread(id, threadTitle);
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
            <h3>Agente Qualita</h3>
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
