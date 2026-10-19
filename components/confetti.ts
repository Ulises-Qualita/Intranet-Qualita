// Ráfaga de confeti con los colores de marca (canvas-confetti). Solo cliente: la
// librería se carga recién al dispararlo, así no pesa en la carga de la página.
// No hace nada si la persona pidió reducir el movimiento (la librería también lo
// respeta con disableForReducedMotion).

import type { Options } from "canvas-confetti";

const COLORS = ["#B50CC5", "#FE6F61", "#252851", "#FFC2B8", "#D98BE6", "#FFF4EC"];

// `origin` en píxeles de la ventana (p. ej. el centro de un punto de la línea).
export async function confetti(origin: { x: number; y: number }) {
  if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const { default: fire } = await import("canvas-confetti");

  const at = { x: origin.x / window.innerWidth, y: origin.y / window.innerHeight };
  const base = { origin: at, colors: COLORS, disableForReducedMotion: true, zIndex: 9999 };
  // La receta "realista" de la librería: varias ráfagas de distinta apertura y
  // velocidad que salen juntas, así no queda un abanico parejo.
  const total = 160;
  const burst = (share: number, opts: Options) =>
    fire({ ...base, ...opts, particleCount: Math.round(total * share) });

  burst(0.25, { spread: 26, startVelocity: 55 });
  burst(0.2, { spread: 60 });
  burst(0.35, { spread: 100, decay: 0.91, scalar: 0.8 });
  burst(0.1, { spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 });
  burst(0.1, { spread: 120, startVelocity: 45 });
}
