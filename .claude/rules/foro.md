---
paths:
  - "**/foro/**"
  - "lib/forum*.ts"
---

# Foro

(Movido desde CLAUDE.md: se carga solo al trabajar con estos archivos.)
- Foro (`/foro`, solapa del sidebar sin área propia, como el agente): mensajes con
  tipo (error/mejora/pregunta), estado y respuestas, en `intranet_forum_posts` /
  `intranet_forum_comments`. **Una sola pantalla**, sin ruta por mensaje:
  `getThreads()` trae todo (dos consultas y el cruce en memoria) y el acordeón de
  `forum-list.tsx` despliega cada uno sin pedir nada. `lib/forum-shared.ts` es el
  modelo client-safe. El **estado solo lo mueve un admin**, y eso no se puede
  expresar con RLS (una política no ve el valor anterior de la fila): va como
  trigger `forum_status_guard_intranet`.
- **Oculto por ahora** (pedido, 2026-10-16): es la función `forum` de `lib/features.ts`, apagada por defecto. Apagada, el sidebar no muestra "Foro" (`hidden` de `Sidebar`, desde `app/(app)/layout.tsx`), `/foro` muestra "Desactivado" y las acciones no escriben. Se prende en Administración → Funciones en prueba; los posts quedan guardados.
