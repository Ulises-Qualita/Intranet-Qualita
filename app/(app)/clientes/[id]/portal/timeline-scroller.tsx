"use client";

import { useEffect, useRef, useState } from "react";

// Contenedor de la línea de tiempo horizontal. Si los hitos no entran, se
// desplaza de costado: al abrir deja "Hoy" a un tercio del ancho (se ve algo de
// lo cumplido y lo que viene) y marca los bordes con un desvanecido según de qué
// lado quede contenido escondido.
export function TimelineScroller({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () =>
      setEdges({ start: el.scrollLeft > 2, end: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });

    const today = el.querySelector<HTMLElement>("[data-today]");
    if (today && el.scrollWidth > el.clientWidth) el.scrollLeft = today.offsetLeft - el.clientWidth / 3;
    update();

    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={`ms-scroll${edges.start ? " fade-start" : ""}${edges.end ? " fade-end" : ""}`}
      // Desplazable con el teclado cuando no entra todo.
      tabIndex={0}
      aria-label="Línea de tiempo de hitos"
      role="region"
    >
      {children}
    </div>
  );
}
