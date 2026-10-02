"use client";

import Link from "next/link";
import { type ComponentProps, useState } from "react";

// Link de navegación (sidebar y solapas) que precarga la pantalla entera cuando
// hay intención de entrar: mouse encima, foco con teclado o dedo apoyado.
//
// Todas las pantallas son dinámicas, y de esas Next solo precarga el esqueleto
// (loading.tsx): los datos se pedían recién con el clic. Con prefetch en true se
// piden antes, así al llegar el clic ya están o vienen en camino. No va en true
// desde el principio porque precargaría todo lo que se ve en pantalla (cada
// cliente del sidebar, cada solapa) aunque nadie entre.
//
// Lo precargado vale 30 s (staleTimes.static en next.config.ts). Solo corre en
// producción: en `npm run dev` Next no precarga nada.
export function NavLink({ onMouseEnter, onFocus, onTouchStart, ...props }: ComponentProps<typeof Link>) {
  const [intent, setIntent] = useState(false);

  return (
    <Link
      {...props}
      prefetch={intent ? true : null}
      onMouseEnter={(e) => {
        setIntent(true);
        onMouseEnter?.(e);
      }}
      onFocus={(e) => {
        setIntent(true);
        onFocus?.(e);
      }}
      onTouchStart={(e) => {
        setIntent(true);
        onTouchStart?.(e);
      }}
    />
  );
}
