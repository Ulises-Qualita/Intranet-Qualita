"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/icons";
import type { BrainArea } from "@/lib/brains";
import { BRAIN_CEREBELLUM, BRAIN_FOLIA, BRAIN_GYRI, BRAIN_LOBES, BRAIN_OUTLINE, BRAIN_ROOTS, BRAIN_STEM } from "./brain-art";

// Mapa de los cerebros internos: un cerebro de perfil en el centro, con el
// isotipo de Qualita, y una tarjeta por área a los costados. Cada tarjeta se une
// al cerebro con una fibra que sale de un puerto en el borde de la tarjeta y, al
// llegar, se abre en raíces que entran al cerebro; por ella viaja una señal hacia
// adentro: la información que lo alimenta. Al pasar por una tarjeta se enciende
// su fibra. En pantallas angostas las fibras se ocultan y las tarjetas quedan en
// grilla debajo del cerebro.
//
// Todo se ubica en un escenario de 1600 de ancho; se muestra la franja
// VIEW (y 140 a 760: sin el aire de arriba y de abajo, pedido) y las tarjetas
// van en porcentajes de esa franja para coincidir con el SVG de las fibras.

const W = 1600;
const H = 900;
const VIEW = { y: 140, h: 620 };
// El dibujo del cerebro (brain-art.ts) se muestra recortado a ART_BOX y va
// escalado dentro del escenario. .brain-core en globals.css usa estos números.
const ART_BOX = { x: 0, y: 20, w: 1024, h: 700 };
const BRAIN = { x: 510, y: 252, scale: 580 / 1024 };
// Borde de las tarjetas: 4% + 23% de ancho (.brain-card en globals.css) = 27% de 1600.
const LEFT_ANCHOR = 432;
const RIGHT_ANCHOR = W - LEFT_ANCHOR;

// Puntos del contorno donde entra cada fibra, de arriba abajo (coordenadas
// del dibujo, medidos sobre BRAIN_OUTLINE; el último de la derecha, sobre el
// cerebelo): el lóbulo frontal a la izquierda; el occipital y el cerebelo a la
// derecha.
const ENTRY = {
  left: [
    [145, 161],
    [101, 216],
    [37, 331],
    [44, 419],
    [56, 469],
  ],
  right: [
    [865, 191],
    [905, 251],
    [979, 373],
    [967, 459],
    [892, 559],
  ],
} as const;

type Pt = [number, number];
const toStage = ([x, y]: readonly number[]): Pt => [BRAIN.x + (x - ART_BOX.x) * BRAIN.scale, BRAIN.y + (y - ART_BOX.y) * BRAIN.scale];
const cardY = (row: number, rows: number) => (rows === 1 ? H / 2 : 220 + (460 / (rows - 1)) * row);
const entryIndex = (side: "left" | "right", row: number, rows: number) =>
  rows === 1 ? 2 : Math.round(((ENTRY[side].length - 1) * row) / (rows - 1));

const r1 = (n: number) => Math.round(n * 10) / 10;
const pt = (x: number, y: number) => `${r1(x)} ${r1(y)}`;

// La conexión de un área: una fibra limpia de la tarjeta al contorno del
// cerebro que, al entrar, sigue por los surcos reales que pasan cerca
// (BRAIN_ROOTS), así se funde con las líneas del dibujo (pedido: "que se
// conecten más armónicamente con las líneas dentro del cerebro"). Antes fueron
// neuronas a mitad de la línea y después un abanico de raíces genéricas.
function fiber(row: number, rows: number, side: "left" | "right") {
  const dir = side === "left" ? 1 : -1;
  const idx = entryIndex(side, row, rows);
  // El puerto va un poco afuera de la tarjeta, para que se vea entero.
  const start: Pt = [(side === "left" ? LEFT_ANCHOR : RIGHT_ANCHOR) + dir * 12, cardY(row, rows)];
  const [bx, by] = toStage(ENTRY[side][idx]);
  // Las manijas de la curva, proporcionales a la distancia: con un tramo corto
  // (la tarjeta del medio, cerca del cerebro) unas fijas hacían un rulo.
  const reach = Math.max(24, Math.abs(bx - start[0]) * 0.5);
  const path = `M${pt(...start)} C${pt(start[0] + dir * reach, start[1])} ${pt(bx - dir * reach, by)} ${pt(bx, by)}`;

  // Cada tramo de surco: un empalme suave desde la entrada hasta su primer punto
  // y después el surco mismo. El más largo continúa la señal.
  const chains = BRAIN_ROOTS[side][idx].map((chain) => chain.map(toStage));
  const traced = chains.map((c) => {
    const [fx, fy] = c[0];
    const joint = `Q${pt(bx + dir * Math.max(6, Math.abs(fx - bx) * 0.6), by)} ${pt(fx, fy)}`;
    return { d: `${joint} ${c.slice(1).map((p) => `L${pt(...p)}`).join(" ")}`, len: c.length };
  });
  const roots = traced.map((t) => `M${pt(bx, by)} ${t.d}`).join(" ");
  const main = traced.reduce((a, b) => (b.len > a.len ? b : a), traced[0]);
  const signal = main ? `${path} ${main.d}` : path;
  const tips = chains.map((c) => c[c.length - 1].map(r1) as Pt);
  return { path, signal, start, roots, tips };
}

export function BrainMap({ areas, base }: { areas: { area: BrainArea; sources: number }[]; base: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const rows = Math.ceil(areas.length / 2);
  const placed = areas.map((a, i) => {
    const side = (i % 2 === 0 ? "left" : "right") as "left" | "right";
    const row = Math.floor(i / 2);
    return { ...a, side, row, n: fiber(row, rows, side) };
  });

  return (
    <div className={`brain-map${hover ? " is-hover" : ""}`}>
      <svg className="brain-links" viewBox={`0 ${VIEW.y} ${W} ${VIEW.h}`} aria-hidden="true">
        <defs>
          <linearGradient id="bn-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#B50CC5" />
            <stop offset="1" stopColor="#FE6F61" />
          </linearGradient>
          <filter id="bn-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.5" />
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {placed.map(({ area, n }, i) => (
          <g key={area.key} className={`fiber${hover === area.key ? " on" : ""}`}>
            <path className="fiber-line" d={n.path} />
            {/* Al entrar, la fibra sigue por los surcos que pasan cerca. */}
            <path className="fiber-roots" d={n.roots} />
            {n.tips.map(([x, y], k) => (
              <circle key={k} className="fiber-tip" cx={x} cy={y} r="2.6" />
            ))}
            {/* La señal: un tramo brillante que viaja de la tarjeta hasta adentro del cerebro. */}
            <path className="fiber-signal" d={n.signal} pathLength={1000} style={{ animationDelay: `${-((i * 0.6) % 3.4)}s` }} />
            <circle className="fiber-port" cx={n.start[0]} cy={n.start[1]} r="5.5" />
            <circle className="fiber-port-dot" cx={n.start[0]} cy={n.start[1]} r="2.2" />
          </g>
        ))}
      </svg>

      <div className="brain-core">
        <BrainDrawing active={hover !== null} />
      </div>

      <div className="brain-cards">
        {placed.map(({ area, sources, side, row }) => (
          <Link
            key={area.key}
            href={`${base}/${area.key}`}
            className={`brain-card ${side}`}
            style={{ top: `${((cardY(row, rows) - VIEW.y) / VIEW.h) * 100}%` }}
            onMouseEnter={() => setHover(area.key)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(area.key)}
            onBlur={() => setHover(null)}
          >
            <span className="brain-card-ico">
              <Icon name={area.icon} size={18} />
            </span>
            <span className="brain-card-body">
              <b>{area.name}</b>
              <span>{area.description}</span>
              <span className="brain-card-meta">
                {sources ? (
                  `${sources} ${sources === 1 ? "fuente" : "fuentes"}`
                ) : (
                  <>
                    <i className="brain-dot" /> Sin información cargada
                  </>
                )}
              </span>
            </span>
            <span className="brain-card-go" aria-hidden>
              <Icon name="chevron" size={16} />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ---------- El cerebro ----------

// El cerebro anatómico de perfil (brain-art.ts, dominio público) en línea suave
// con el degradado de marca, y destellos que recorren algunos surcos todo el
// tiempo, como si estuviera pensando (opción C elegida por el usuario entre
// cinco). Con una tarjeta activa los destellos se aceleran. El isotipo de
// Qualita va en un círculo al centro.
const SIGNALS = BRAIN_GYRI.filter((_, i) => i % 3 === 0);
const LOGO: Pt = [470, 300];
const LOGO_R = 76;

function BrainDrawing({ active }: { active: boolean }) {
  return (
    <svg
      className={`brain-art${active ? " active" : ""}`}
      viewBox={`${ART_BOX.x} ${ART_BOX.y} ${ART_BOX.w} ${ART_BOX.h}`}
      role="img"
      aria-label="Cerebro de Qualita"
    >
      <defs>
        <linearGradient id="br-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#B50CC5" />
          <stop offset="1" stopColor="#FE6F61" />
        </linearGradient>
        <radialGradient id="br-halo">
          <stop offset="0" stopColor="#B50CC5" stopOpacity=".16" />
          <stop offset="1" stopColor="#B50CC5" stopOpacity="0" />
        </radialGradient>
        <filter id="br-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" />
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <ellipse className="brain-halo" cx="500" cy="350" rx="520" ry="380" fill="url(#br-halo)" />
      <path className="brain-base edge" d={BRAIN_STEM} />
      <path className="brain-base edge" d={BRAIN_CEREBELLUM} />
      {BRAIN_LOBES.map((d) => (
        <path key={d} className="brain-base" d={d} />
      ))}
      <path className="brain-folia" d={BRAIN_FOLIA.join("")} />
      <path className="brain-gyri" d={BRAIN_GYRI.join("")} />
      <path className="brain-outline" d={BRAIN_OUTLINE} />
      <g className="brain-signals">
        {SIGNALS.map((d, i) => (
          <path key={i} className="brain-signal" d={d} pathLength={1000} style={{ animationDelay: `${-((i * 0.53) % 3.6)}s` }} />
        ))}
      </g>
      <circle className="brain-logo-ring" cx={LOGO[0]} cy={LOGO[1]} r={LOGO_R + 14} />
      <circle className="brain-logo-bg" cx={LOGO[0]} cy={LOGO[1]} r={LOGO_R} />
      <image href="/qualita-isotipo.png" x={LOGO[0] - LOGO_R * 0.62} y={LOGO[1] - LOGO_R * 0.64} width={LOGO_R * 1.24} height={LOGO_R * 1.28} />
    </svg>
  );
}
