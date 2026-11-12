"use client";

import { useEffect, useState } from "react";
import { contrast } from "@/lib/brand-shared";

// Colores reales de cada logo (se leen de la imagen en el navegador) para ponerlo
// sobre un fondo donde se lea: blanco, los colores de la marca o casi negro.

export type LogoTone = {
  // Muestra de los colores del logo (sin el fondo, si la imagen trae uno).
  colors: string[];
  // La imagen no es transparente: trae su propio fondo (ese color).
  ownBackground: string | null;
  // Ancho / alto del dibujo (sin el fondo propio ni el aire transparente).
  aspect: number;
};

const cache = new Map<string, Promise<LogoTone | null>>();

const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`.toUpperCase();

function analyze(url: string): Promise<LogoTone | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onerror = () => resolve(null);
    img.onload = () => {
      try {
        const w0 = img.naturalWidth || 300;
        const h0 = img.naturalHeight || 150;
        const k = Math.min(1, 120 / Math.max(w0, h0));
        const [w, h] = [Math.max(1, Math.round(w0 * k)), Math.max(1, Math.round(h0 * k))];
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, w, h);
        const d = ctx.getImageData(0, 0, w, h).data;
        const px = (x: number, y: number) => {
          const i = (y * w + x) * 4;
          return [d[i], d[i + 1], d[i + 2], d[i + 3]];
        };

        // Fondo propio: las cuatro esquinas opacas y del mismo color.
        const corners = [px(0, 0), px(w - 1, 0), px(0, h - 1), px(w - 1, h - 1)];
        const sameColor = corners.every((c) => c[3] > 250 && Math.max(...[0, 1, 2].map((j) => Math.abs(c[j] - corners[0][j]))) < 16);
        const own = sameColor ? corners[0] : null;

        const colors: string[] = [];
        // Caja de lo dibujado, para saber la forma real del logo.
        let [minX, minY, maxX, maxY] = [w, h, -1, -1];
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const j = (y * w + x) * 4;
            if (d[j + 3] < 140) continue;
            if (own && Math.max(Math.abs(d[j] - own[0]), Math.abs(d[j + 1] - own[1]), Math.abs(d[j + 2] - own[2])) < 30) continue;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
        const step = Math.max(1, Math.floor((w * h) / 1500));
        for (let i = 0; i < w * h; i += step) {
          const [r, g, b, a] = [d[i * 4], d[i * 4 + 1], d[i * 4 + 2], d[i * 4 + 3]];
          if (a < 140) continue;
          if (own && Math.max(Math.abs(r - own[0]), Math.abs(g - own[1]), Math.abs(b - own[2])) < 30) continue;
          colors.push(hex(r, g, b));
        }
        const aspect = (maxX >= minX ? (maxX - minX + 1) / (maxY - minY + 1) : w / h) || w / h;
        resolve({ colors, ownBackground: own ? hex(own[0], own[1], own[2]) : null, aspect });
      } catch {
        // Sin CORS el canvas queda "manchado" y no se puede leer.
        resolve(null);
      }
    };
    img.src = url;
  });
}

const tone = (url: string) => {
  if (!cache.has(url)) cache.set(url, analyze(url));
  return cache.get(url)!;
};

// Tonos de varios logos, por URL; se completan a medida que se leen.
export function useLogoTones(urls: (string | null)[]) {
  const [tones, setTones] = useState<Record<string, LogoTone | null>>({});
  const key = urls.filter(Boolean).join("|");
  useEffect(() => {
    let alive = true;
    for (const url of key ? key.split("|") : []) {
      void tone(url).then((t) => {
        if (alive) setTones((prev) => (url in prev ? prev : { ...prev, [url]: t }));
      });
    }
    return () => {
      alive = false;
    };
  }, [key]);
  return tones;
}

// Qué tan bien se lee el logo sobre un fondo: el contraste que alcanza el 85% del
// logo (así un detalle chico de otro color no decide).
export function readability(t: LogoTone, bg: string) {
  if (!t.colors.length) return 21;
  const ratios = t.colors.map((c) => contrast(c, bg)).sort((a, b) => a - b);
  return ratios[Math.floor(ratios.length * 0.15)];
}

// El primero de `options` (en orden de preferencia) donde el logo se lee bien; si
// ninguno llega, el de más contraste. Un logo con fondo propio va sobre ese color.
export function bestBackground(t: LogoTone, options: string[]) {
  if (t.ownBackground) return t.ownBackground;
  const good = options.find((bg) => readability(t, bg) >= 3);
  return good ?? options.reduce((best, bg) => (readability(t, bg) > readability(t, best) ? bg : best), options[0]);
}
