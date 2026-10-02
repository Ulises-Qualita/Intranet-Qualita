import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Todas las pantallas son dinámicas (leen la sesión), y por defecto el
    // navegador no guarda ninguna: volver a una solapa recién vista repetía el
    // viaje al server. Con `dynamic`, lo visto en los últimos 30 s se muestra al
    // instante. Las Server Actions (revalidatePath) y router.refresh() siguen
    // descartando lo guardado, así que después de guardar algo se ve el dato nuevo.
    //
    // `static` es lo que dura una pantalla precargada (components/nav-link.tsx):
    // por defecto 5 min, demasiado para datos en vivo. 30 es el mínimo que acepta Next.
    staleTimes: { dynamic: 30, static: 30 },
  },
};

export default nextConfig;
