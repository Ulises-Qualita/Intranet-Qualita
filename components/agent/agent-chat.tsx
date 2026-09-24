"use client";

// Burbuja del agente, abajo a la derecha de toda la intranet. La conversación en
// sí vive en AgentConversation, que es la misma que usa /agente en grande.
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "../icons";
import { AgentConversation } from "./agent-conversation";

export function AgentChat({ userName, suggestions }: { userName: string; suggestions: string[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // En la pantalla del agente la burbuja sobraría: taparía el mismo chat.
  if (pathname === "/agente") return null;

  return (
    <>
      <button
        type="button"
        className={`agent-fab${open ? " on" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Cerrar Agente Q" : "Abrir Agente Q"}
      >
        {open ? (
          <Icon name="close" size={22} />
        ) : (
          // El isotipo ya trae el degradado de marca, así que el botón va sobre
          // fondo claro: encima del degradado se perdería contra sí mismo.
          <Image src="/Agente.png" alt="" width={36} height={36} priority />
        )}
      </button>

      {/* Fondo atenuado, como un modal. Es un button y no un div para que cerrar
          con el mouse y cerrar con el teclado sean la misma cosa. */}
      {open && (
        <button type="button" className="agent-backdrop" onClick={() => setOpen(false)} aria-label="Cerrar Agente Q" />
      )}

      {open && (
        <section className="agent-panel" aria-label="Agente Q">
          <AgentConversation userName={userName} suggestions={suggestions} variant="panel" onClose={() => setOpen(false)} />
        </section>
      )}
    </>
  );
}
