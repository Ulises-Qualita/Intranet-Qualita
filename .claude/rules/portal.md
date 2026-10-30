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
  un vidrio apoyado en su borde (logo, nombre del cliente y título); la bienvenida debajo, fuera del vidrio y con una franja en degradado (`.pt-intro`), separando el banner de las cards; en `/mi-empresa` la solapa del portal va primera (`lib/client-zone.ts`, pedido) y es donde entra el cliente al loguearse (`app/auth/actions.ts` y `CLIENT_HOME` de `proxy.ts`; sin Notion conectado, el layout del portal lo manda a Vista general); la card del % está **oculta por ahora** (`SHOW_STAGES` en `portal-view.tsx`, pedido; se sigue cargando en Editar portal → Etapas); la card del % (`portal-progress.tsx`)
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
  confidencialidad. **Editar portal** tiene dos solapas: General (banner y
  responsable) y Etapas (`stages-editor.tsx`: radio con las tres etapas y, salvo en
  Motor de Demanda, un slider del avance; `savePortalPhase`, sin migración). Los tickets de Notion solo van al
  calendario; su estado se traduce a Pendiente / En curso / Completada y define el
  color del ticket (gris / magenta / verde, `STAGE_STATUS`; pedido: nada de rojos).
  La propiedad "Pilar" del ticket (select o multi-select, se busca por nombre, con
  el color de Notion) va como pill debajo del título, igual que el Entregable en
  los calendarios de Notion; sin Pilar en ningún ticket, una sola línea.
- Hitos del proyecto: **solo tickets de Notion** (pedido 2026-10-19). La línea muestra
  los mismos tickets del calendario del portal (proyecto del cliente, checkbox del
  portal tildado) que tienen fecha, en su inicio si es un rango, con el estado traducido
  como etiqueta (`timelineEntries` en `portal/milestone-timeline.tsx`). La etiqueta
  es el **nombre del estado en Notion** (`NotionTicket.statusName`, pedido
  2026-10-30; "In progress" se muestra "En curso" y "Ejecutar", "Pendiente": `STATUS_LABEL`) y el color, el grupo del mapeo
  (terminado verde, en curso magenta, bloqueado violeta, pendiente gris). Ya no se
  cargan hitos a mano: se sacó la solapa Hitos de Editar portal y el código de
  `intranet_client_milestones` (la tabla sigue en la base, sin uso). La línea es
  **horizontal** y sigue el estilo del
  [Timeline de Dice UI](https://21st.dev/@diceui/components/timeline) que eligió el
  usuario (punto de 14 px, conector de 2 px, título / fecha / descripción debajo, texto
  alineado a la izquierda), con "magia": cumplidos en degradado con tilde, el activo
  (primer hito de hoy en adelante) con anillo en degradado y halo, y el tramo que
  llega a él lleno según el tiempo transcurrido, con un brillo y una luz en la punta.
  Se descartaron (no le gustaron): lista vertical, columnas simples con "Hoy", una
  cinta a escala real tipo editor de video y el texto centrado. Si no entra,
  `portal/timeline-scroller.tsx` desplaza de costado hasta el activo (`data-today`),
  con flechas a los costados (solo del lado donde hay más) y arrastre con el mouse.
  Desde 2026-10-30 (pedido, para que muestre en qué se trabaja): cada punto va en
  el **inicio** del ticket (o su única fecha) y la línea llega cuando arranca; el
  tramo al siguiente se llena por tiempo. El **tilde sale del estado en Notion**
  (grupo terminado), no de la fecha; arrancado y no terminado = activo (puede haber
  más de uno); si la fecha de fin pasó sin terminar, no se muestra "Termina en…".
