"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Canal privado de Realtime Presence (políticas en docs/sql/2026-09-25-presence.sql).
const TOPIC = "intranet:presence";

// null: todavía no se sabe, o el canal no está habilitado (falta el SQL). La UI
// no muestra nada en ese caso, en vez de marcar a todos como desconectados.
const PresenceContext = createContext<Set<string> | null>(null);

// Va en el layout: mientras haya una pestaña de la intranet abierta, el usuario
// figura en línea. Realtime lo saca solo cuando se cierra o se corta la conexión.
export function PresenceProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  const [online, setOnline] = useState<Set<string> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(TOPIC, { config: { private: true, presence: { key: userId, enabled: true } } });
    let active = true;

    channel.on("presence", { event: "sync" }, () => {
      if (active) setOnline(new Set(Object.keys(channel.presenceState())));
    });

    // El canal privado valida el JWT del usuario: se carga antes de suscribirse.
    supabase.realtime.setAuth().then(() => {
      if (!active) return;
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") channel.track({ at: new Date().toISOString() });
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setOnline(null);
      });
    });

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [userId]);

  return <PresenceContext.Provider value={online}>{children}</PresenceContext.Provider>;
}

export const useOnline = () => useContext(PresenceContext);

// Punto verde sobre el avatar.
export function OnlineDot({ userId }: { userId: string }) {
  const online = useOnline();
  if (!online?.has(userId)) return null;
  return <span className="online-dot" title="En línea" aria-label="En línea" />;
}

// Estado en texto, para la fila de la tarjeta del miembro.
export function OnlineStatus({ userId }: { userId: string }) {
  const online = useOnline();
  if (!online) return null;
  return online.has(userId) ? (
    <span className="online-label">
      <i aria-hidden /> En línea
    </span>
  ) : (
    <span className="muted">Desconectado</span>
  );
}

// Resumen para el topbar de Equipo.
export function OnlineCount() {
  const online = useOnline();
  if (!online) return null;
  return (
    <span className="online-count">
      <i aria-hidden /> {online.size} en línea
    </span>
  );
}
