"use client";

import { useEffect, useRef, useState } from "react";
import { confetti } from "@/components/confetti";
import { Icon } from "@/components/icons";

// Contenedor de la línea de tiempo horizontal. Si los hitos no entran, se
// desplaza de costado: al abrir deja "Hoy" a un tercio del ancho (se ve algo de
// lo cumplido y lo que viene) y marca los bordes con un desvanecido según de qué
// lado quede contenido escondido. Para moverse: flechas a los costados (aparecen
// solo del lado donde hay más), arrastrar con el mouse, la rueda o el teclado.
export function TimelineScroller({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  // Arrastre con el mouse (en touch ya desplaza el navegador).
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);

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

    // Confeti la primera vez que la línea aparece en pantalla (una por visita):
    // sale del último hito completado o, si no hay, del activo. Espera a que
    // terminen de entrar los puntos.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        timer = setTimeout(() => {
          const dot = (el.querySelector("[data-last-done]") ?? el.querySelector("[data-today]"))?.querySelector(".tl-dot");
          if (!dot) return;
          const box = dot.getBoundingClientRect();
          // Si quedó escondido de costado, desde el centro de la línea.
          const wrap = el.getBoundingClientRect();
          const visible = box.left >= wrap.left && box.right <= wrap.right;
          confetti({ x: visible ? box.left + box.width / 2 : wrap.left + wrap.width / 2, y: box.top + box.height / 2 });
        }, 700);
      },
      { threshold: 0.6 },
    );
    observer.observe(el);

    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      observer.disconnect();
      clearTimeout(timer);
    };
  }, []);

  // Una "página": casi todo el ancho visible, así queda algo de contexto.
  const page = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: smooth ? "smooth" : "auto" });
  };

  return (
    <div className="ms-scroll-wrap">
      <div
        ref={ref}
        className={`ms-scroll${edges.start ? " fade-start" : ""}${edges.end ? " fade-end" : ""}${
          edges.start || edges.end ? " can-drag" : ""
        }${dragging ? " dragging" : ""}`}
        // Desplazable con el teclado cuando no entra todo.
        tabIndex={0}
        aria-label="Línea de tiempo de hitos"
        role="region"
        onPointerDown={(e) => {
          const el = ref.current;
          if (e.pointerType !== "mouse" || e.button !== 0 || !el || el.scrollWidth <= el.clientWidth) return;
          drag.current = { x: e.clientX, left: el.scrollLeft, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          const el = ref.current;
          if (!d || !el) return;
          const dx = e.clientX - d.x;
          // Unos píxeles de margen para que un clic no cuente como arrastre.
          if (!d.moved && Math.abs(dx) < 4) return;
          if (!d.moved) {
            d.moved = true;
            setDragging(true);
            el.setPointerCapture(e.pointerId);
          }
          el.scrollLeft = d.left - dx;
        }}
        onPointerUp={() => {
          drag.current = null;
          setDragging(false);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDragging(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "PageDown" || e.key === "PageUp") {
            e.preventDefault();
            page(e.key === "PageDown" ? 1 : -1);
          }
        }}
      >
        {children}
      </div>
      {edges.start && (
        <button type="button" className="ms-arrow prev" onClick={() => page(-1)} aria-label="Ver hitos anteriores">
          <Icon name="chevron" size={18} />
        </button>
      )}
      {edges.end && (
        <button type="button" className="ms-arrow next" onClick={() => page(1)} aria-label="Ver hitos siguientes">
          <Icon name="chevron" size={18} />
        </button>
      )}
    </div>
  );
}
