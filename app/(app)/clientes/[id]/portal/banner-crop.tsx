"use client";

import { useRef } from "react";
import type { BannerPosition } from "@/lib/portal";

const clamp = (v: number) => Math.min(100, Math.max(0, v));

// Vista previa del banner en "Editar portal", con el mismo recorte que el portal:
// arrastrando la imagen se elige qué parte queda a la vista. Lo que se mueve es
// el object-position, así que no se recorta ni se vuelve a subir el archivo.
export function BannerCrop({
  src,
  position,
  onChange,
  disabled,
}: {
  src: string;
  position: BannerPosition;
  onChange: (position: BannerPosition) => void;
  disabled?: boolean;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number; start: BannerPosition; overflowX: number; overflowY: number } | null>(null);

  function onPointerDown(e: React.PointerEvent<HTMLImageElement>) {
    const img = imgRef.current;
    if (disabled || !img?.naturalWidth) return;
    // Con object-fit: cover la imagen se escala hasta cubrir el recuadro; lo que
    // sobra en cada eje es lo que se puede desplazar (0 en el eje que entra justo).
    const box = img.getBoundingClientRect();
    const scale = Math.max(box.width / img.naturalWidth, box.height / img.naturalHeight);
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      start: position,
      overflowX: img.naturalWidth * scale - box.width,
      overflowY: img.naturalHeight * scale - box.height,
    };
    img.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onPointerMove(e: React.PointerEvent<HTMLImageElement>) {
    const d = drag.current;
    if (!d) return;
    // Arrastrar hacia abajo muestra lo de arriba: el porcentaje baja.
    onChange({
      x: d.overflowX > 0 ? clamp(d.start.x - ((e.clientX - d.x) / d.overflowX) * 100) : d.start.x,
      y: d.overflowY > 0 ? clamp(d.start.y - ((e.clientY - d.y) / d.overflowY) * 100) : d.start.y,
    });
  }

  function onPointerUp() {
    drag.current = null;
  }

  return (
    <div className="banner-drop has-banner banner-crop">
      {/* eslint-disable-next-line @next/next/no-img-element -- banner actual o vista previa local (blob:) */}
      <img
        ref={imgRef}
        src={src}
        alt="Banner del portal"
        draggable={false}
        style={{ objectPosition: `${position.x}% ${position.y}%` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <span className="banner-crop-hint">Arrastrá para acomodar</span>
    </div>
  );
}
