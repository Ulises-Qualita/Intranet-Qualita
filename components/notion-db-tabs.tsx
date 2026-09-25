"use client";

import { useId, useState, type ReactNode } from "react";

// Solapas de las vistas de una database ("Calendario", "Etapas"…), como arriba
// de una database en Notion. Cada vista llega ya dibujada desde el server; acá
// solo se elige cuál mostrar. Las ocultas quedan montadas (con `hidden`) para que
// el calendario no pierda el mes elegido al ir y volver.
export function NotionDbTabs({ names, children }: { names: string[]; children: ReactNode[] }) {
  const [active, setActive] = useState(0);
  const id = useId();

  if (names.length < 2) return <>{children}</>;

  return (
    <div className="nd-views">
      <div className="nd-tabs" role="tablist">
        {names.map((name, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            id={`${id}-t${i}`}
            aria-selected={i === active}
            aria-controls={`${id}-p${i}`}
            className={`nd-tab${i === active ? " on" : ""}`}
            onClick={() => setActive(i)}
          >
            {name}
          </button>
        ))}
      </div>
      {children.map((pane, i) => (
        <div key={i} role="tabpanel" id={`${id}-p${i}`} aria-labelledby={`${id}-t${i}`} hidden={i !== active}>
          {pane}
        </div>
      ))}
    </div>
  );
}
