"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import type { EditEvent } from "@/app/api/reportes/[id]/editar/route";
import { undoReport } from "./actions";

type Message = { role: "user" | "assistant"; content: string; applied?: number; error?: boolean };

// "Hacer una modificación": chat con Claude sobre un reporte ya guardado. Cada
// pedido se aplica sobre el HTML y queda guardado; el último se puede deshacer.
export function EditReportButton({ clientSlug, id, period }: { clientSlug: string; id: string; period: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState("");
  const [version, setVersion] = useState(0);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [undoing, startUndo] = useTransition();
  const router = useRouter();

  useEffect(() => {
    const box = scroller.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [messages, thinking]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    const history = messages.filter((m) => !m.error).map(({ role, content }) => ({ role, content }));
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setDraft("");
    setBusy(true);
    setThinking("");
    setUndoError(null);

    let finished = false;
    try {
      const res = await fetch(`/api/reportes/${id}/editar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history }),
      });
      if (!res.ok || !res.body) throw new Error("No se pudo enviar el pedido.");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const line = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const e = JSON.parse(line.slice(6)) as EditEvent;
          if (e.type === "thinking") setThinking((t) => t + e.text);
          if (e.type === "done") {
            finished = true;
            setMessages((prev) => [...prev, { role: "assistant", content: e.reply, applied: e.applied }]);
            if (e.applied) {
              setVersion((v) => v + 1);
              router.refresh();
            }
          }
          if (e.type === "error") {
            finished = true;
            setMessages((prev) => [...prev, { role: "assistant", content: e.message, error: true }]);
          }
        }
      }
      if (!finished) throw new Error("El pedido se cortó antes de terminar.");
    } catch (e) {
      if (!finished) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: e instanceof Error ? e.message : "No se pudo hacer el cambio.", error: true },
        ]);
      }
    } finally {
      setBusy(false);
      setThinking("");
    }
  }

  function undo() {
    setUndoError(null);
    startUndo(async () => {
      const result = await undoReport(clientSlug, id);
      if (!result.ok) return setUndoError(result.error ?? "No se pudo deshacer.");
      setMessages((prev) => [...prev, { role: "assistant", content: "Listo, volví a la versión anterior al último cambio." }]);
      setVersion((v) => v + 1);
      router.refresh();
    });
  }

  const close = () => {
    if (!busy) dialog.current?.close();
  };

  return (
    <>
      <button type="button" className="report-act" title="Pedirle a Claude un cambio puntual" onClick={() => dialog.current?.showModal()}>
        <Icon name="sparkles" size={16} />
        <span>Modificar</span>
      </button>

      <dialog
        ref={dialog}
        className="modal"
        aria-labelledby={`redit-title-${id}`}
        onCancel={(e) => {
          if (busy) e.preventDefault();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        <div className="modal-card redit">
          <div className="redit-head">
            <div>
              <h2 id={`redit-title-${id}`}>Hacer una modificación</h2>
              <span>Reporte {period}</span>
            </div>
            <button type="button" className="modal-close" onClick={close} disabled={busy} aria-label="Cerrar">
              ×
            </button>
          </div>

          <div ref={scroller} className="redit-chat">
            <div className="redit-msg assistant">
              Contame qué querés cambiar del reporte y lo modifico. Los cambios se guardan en el reporte; el último se puede
              deshacer.
            </div>
            {messages.map((m, i) => (
              <div key={i} className={`redit-msg ${m.role}${m.error ? " error" : ""}`}>
                {m.content}
                {!!m.applied && (
                  <span className="redit-applied">
                    <Icon name="check" size={12} strokeWidth={2.6} />
                    {m.applied === 1 ? "1 cambio aplicado" : `${m.applied} cambios aplicados`}
                  </span>
                )}
              </div>
            ))}
            {busy && (
              <div className="report-thinking redit-thinking">
                <div className="report-thinking-head">
                  <i />
                  Claude está pensando
                </div>
                {thinking && <div className="report-thinking-text">{thinking}</div>}
              </div>
            )}
          </div>

          <form
            className="redit-composer"
            onSubmit={(e) => {
              e.preventDefault();
              send(draft);
            }}
          >
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(draft);
                }
              }}
              placeholder="Ej.: en próximos pasos, cambiá la prioridad 2 por…"
              rows={2}
              disabled={busy}
            />
            <button type="submit" className="connect-btn" disabled={busy || !draft.trim()} aria-label="Enviar">
              <Icon name="send" size={17} />
            </button>
          </form>

          <div className="redit-foot">
            <a className="report-act" href={`/api/reportes/${id}?v=${version}`} target="_blank" rel="noopener">
              <Icon name="eye" size={16} />
              <span>Ver reporte</span>
            </a>
            <button type="button" className="report-act" onClick={undo} disabled={busy || undoing}>
              <Icon name="refresh" size={16} />
              <span>{undoing ? "Deshaciendo…" : "Deshacer último cambio"}</span>
            </button>
            {undoError && <span className="redit-undo-error">{undoError}</span>}
          </div>
        </div>
      </dialog>
    </>
  );
}
