---
paths:
  - "**/portal/**"
  - "lib/portal.ts"
  - "lib/milestones*.ts"
---

# Portal del cliente e Hitos

(Movido desde CLAUDE.md: se carga solo al trabajar con estos archivos.)
- Portal del cliente (`/clientes/[slug]/portal` y `/mi-empresa/portal`, misma
  `PortalView`): **armado en la intranet**, ya no lee una página de Notion. Banner y
  responsable validador los carga el equipo desde "Editar portal" y van en
  `intranet_clients.portal` (`lib/portal.ts`, `getPortalSettings`); el banner es un
  objeto por cliente en el bucket público `intranet-client-banners` (como los logos,
  subida con URL firmada) y su versión va en `portal.banner`
  (`docs/sql/2026-10-05-portal-intranet.sql`). Qué parte del banner se ve la elige
  el equipo en "Editar portal", arrastrando la vista previa (`banner-crop.tsx`): es
  el `object-position` en % y va en `portal.bannerPosition`; una imagen nueva arranca
  centrada. En el portal el banner es una imagen fija, sin controles. El ícono es el logo del cliente.
  Textos de bienvenida y de confidencialidad fijos. El roadmap son los tickets del
  proyecto del cliente con el checkbox "Portal de cliente" tildado
  (`NotionTicket.portal`; el checkbox se elige en `/admin/notion` y, si no, se toma
  el que diga "portal"). **Diseño en vidrio** (clases `.pt-*` en `app/globals.css`),
  elegido por el usuario entre propuestas. De arriba hacia abajo: el banner grande con
  un vidrio apoyado en su borde (logo, nombre del cliente y título); la bienvenida debajo, fuera del vidrio y con una franja en degradado (`.pt-intro`), separando el banner de las cards; en `/mi-empresa` la solapa del portal va primera (`lib/client-zone.ts`, pedido); la card del % (`portal-progress.tsx`)
  con las **etapas del proyecto**, que son **fijas e iguales para todos los clientes**
  (`PROJECT_STAGES`): Arquitectura de Marca → Infraestructura Digital → Motor de
  Demanda. El equipo elige la actual y su avance 0–100 (`portal.phase`,
  `parsePhase`; las anteriores cuentan como completadas). Las dos primeras son la
  construcción y valen 50% cada una (`phasePercent`: marca al 60% → 30%, infra al 20%
  → 60%). Motor de Demanda es la pauta, un **servicio mensual que no termina**: el
  anillo queda lleno con un ∞ (SVG, Lexend no trae el carácter) y "Servicio mensual
  activo", y su segmento de la barra lleva un brillo que corre (decidido con el
  usuario: sin fecha de inicio). La barra tiene un segmento por etapa con el nombre
  debajo; el anillo se llena al abrir con `@property --pt-p`. La lista libre de
  etapas de antes (`portal.stages`) se dejó de leer y se borra al guardar. El calendario a todo el ancho
  (`DbViews` de `components/notion-content.tsx` sobre la database de `roadmapDb`:
  tickets de Notion + reuniones, solapas Calendario y Reuniones; sin tabla de etapas y
  sin card de próximas reuniones, pedido); la línea de **Hitos** (ver abajo); y, lado
  a lado, el responsable validador (nombre, cargo y WhatsApp como texto, **sin
  botón**: el portal lo ve el cliente y el responsable es de su lado) y la
  confidencialidad. **Editar portal** tiene tres solapas: General (banner y
  responsable), Etapas (`stages-editor.tsx`: radio con las tres etapas y, salvo en
  Motor de Demanda, un slider del avance; `savePortalPhase`, sin migración) e Hitos (`milestones-editor.tsx`). Los tickets de Notion solo van al
  calendario; su estado se traduce a Pendiente / En curso / Completada.
- Hitos del proyecto: **ya no son una solapa** (se sacó a pedido; viven en el Portal
  del cliente y se cargan en Editar portal → Hitos, `portal/milestones-editor.tsx`:
  tipo, fecha, título, descripción; cada cambio se guarda al momento con
  `portal/milestone-actions.ts`, que revalida el portal). Tipos `inicio | hito |
  entrega | lanzamiento` en `lib/milestones-shared.ts` (client-safe). La línea
  (`portal/milestone-timeline.tsx`) es **horizontal** y sigue el estilo del
  [Timeline de Dice UI](https://21st.dev/@diceui/components/timeline) que eligió el
  usuario (punto de 14 px, conector de 2 px, título / fecha / descripción debajo, texto
  alineado a la izquierda), con "magia": cumplidos en degradado con tilde, el activo
  (primer hito de hoy en adelante) con anillo en degradado y halo, y el tramo que
  llega a él lleno según el tiempo transcurrido, con un brillo y una luz en la punta.
  Se descartaron (no le gustaron): lista vertical, columnas simples con "Hoy", una
  cinta a escala real tipo editor de video y el texto centrado. Si no entra,
  `portal/timeline-scroller.tsx` desplaza de costado hasta el activo (`data-today`).
  Cumplido / activo / pendiente sale de la fecha, no se guarda. Tabla
  `intranet_client_milestones` (`docs/sql/2026-10-08-hitos.sql`; RLS: equipo con
  `clientes` escribe, la cuenta del cliente lee los suyos), `lib/milestones.ts`.
