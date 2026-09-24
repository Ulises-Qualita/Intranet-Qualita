"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { WEEKDAYS, type CalMonth } from "@/lib/notion-blocks";

// Umbral del gesto: menos que esto es un toque o un scroll vertical torcido.
const SWIPE_PX = 50;

// Calendario de una database embebida, un mes a la vez como la vista de Notion:
// título del mes a la izquierda y "‹ Hoy ›" a la derecha. En touch se pasa de mes
// deslizando. Los meses llegan armados desde el server; acá solo se elige cuál ver.
export function NotionCalendar({ months, initial }: { months: CalMonth[]; initial: number }) {
  const [index, setIndex] = useState(initial);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const month = months[index];
  // Si el roadmap ya terminó o no empezó, abre en un extremo y "Hoy" mentiría.
  const hasToday = months[initial]?.weeks.some((w) => w.some((d) => d.isToday && d.inMonth)) ?? false;
  const go = (i: number) => setIndex(Math.min(months.length - 1, Math.max(0, i)));

  return (
    <div className="nd-cal">
      {month && (
        <div
          className="nd-cal-month"
          onTouchStart={(e) => {
            const t = e.touches[0];
            touch.current = { x: t.clientX, y: t.clientY };
          }}
          onTouchEnd={(e) => {
            const start = touch.current;
            touch.current = null;
            if (!start) return;
            const t = e.changedTouches[0];
            const dx = t.clientX - start.x;
            if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(t.clientY - start.y)) return;
            go(index + (dx < 0 ? 1 : -1));
          }}
        >
          <div className="nd-cal-head">
            <div className="nd-cal-title" aria-live="polite">
              {month.label}
            </div>
            {months.length > 1 && (
              <div className="nd-cal-nav">
                <button
                  type="button"
                  className="nd-cal-btn"
                  onClick={() => go(index - 1)}
                  disabled={index === 0}
                  aria-label="Mes anterior"
                >
                  <Icon name="chevron" size={15} className="flip" />
                </button>
                {hasToday && (
                  <button
                    type="button"
                    className="nd-cal-btn today"
                    onClick={() => go(initial)}
                    disabled={index === initial}
                  >
                    Hoy
                  </button>
                )}
                <button
                  type="button"
                  className="nd-cal-btn"
                  onClick={() => go(index + 1)}
                  disabled={index === months.length - 1}
                  aria-label="Mes siguiente"
                >
                  <Icon name="chevron" size={15} />
                </button>
              </div>
            )}
          </div>

          {/* key por mes: remonta la grilla y dispara la animación de entrada. */}
          <div key={month.key} className="nd-cal-grid">
            {WEEKDAYS.map((d) => (
              <div key={d} className="nd-cal-wd">
                {d}
              </div>
            ))}
            {month.weeks.flat().map((day) => (
              <div key={day.iso} className={`nd-cal-day${day.inMonth ? "" : " out"}${day.isToday ? " today" : ""}`}>
                <span className="nd-cal-num">{day.day}</span>
                {day.events.map((e) => (
                  <span key={e.id} className={`nd-ev c-${e.color}`} title={e.title}>
                    {e.title}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
