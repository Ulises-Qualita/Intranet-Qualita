---
paths:
  - "**/cerebros/**"
  - "lib/brains.ts"
---

# Cerebros

- Idea del usuario (2026-11-16): dos cosas distintas. (1) **Cerebros internos de
  Qualita**, uno por área del equipo (redes, SEO, web, pauta, branding,
  estrategia…), en la solapa Cerebros del panel interno (`/clientes/qualita/cerebros`).
  (2) Más adelante, una sección **Cerebro dentro de cada cliente**, alimentada por
  reuniones con el cliente, sus redes, mails, etc. Se empezó por (1).
- Cada cerebro se alimenta de información cargada a mano (PDF, MD, archivos,
  notas) y, más adelante, de grabaciones de reuniones (sin definir: grabaciones de
  Workspace / Meet o una herramienta como Read.ai). Con ese contexto y criterio se
  van a generar **skills** de cada área.
- Estado: **las reuniones ya se guardan** (Etapa 1, 2026-11-26, ver abajo).
  Documentos y notas siguen siendo **solo interfaz**: la carga deja lo elegido en
  pantalla como "Sin guardar", con el aviso de que no está conectada. No inventar
  fuentes ni datos de muestra.
- Reuniones (Etapa 1, carga manual por área; pedido: "en un futuro que se carguen
  solas dependiendo la nomenclatura de la reunión o quién participe" = Etapa 2,
  pendiente, con sugerencias para aceptar antes de cargar solas). Tabla
  `intranet_brain_meetings` (`docs/sql/2026-11-26-cerebros-reuniones.sql`, RLS sin
  políticas, service_role después de validar equipo con área `clientes`). En
  "Cargar información" → **Reunión** (`meeting-loader.tsx`), tres formas:
  archivo (el usuario exporta Claude meetings en **.md**, la recomendada; también
  .txt, .vtt/.srt, .docx con mammoth y .pdf con pdf.js; el texto se saca **en el
  navegador**, `extract-text.ts`, y al server viaja solo el texto), texto pegado, o
  **De mi calendario**: `getRecordedMeetings` lee los últimos 60 días del calendario
  de quien carga y muestra los eventos con Google Docs adjuntos (lo que deja Meet:
  transcripción y notas de Gemini; el usuario usa las dos); `readMeetingDocs` los
  exporta como texto desde Drive **como quien carga** (scope `drive`, el que ya
  tiene la delegación). `POST /api/cerebros/interpretar` → `interpretMeeting`
  (`lib/brain-meetings.ts`, structured outputs, tarea de IA `cerebro`, consumo
  `kind = 'cerebro'`): **solo criterios y aprendizajes del área** (pedido: "lo que
  quiero extraer son los criterios y aprendizajes, sobre todo del área del
  cerebro; el resto no es necesario": se sacaron resumen, decisiones, problemas,
  pendientes y frases), escritos como criterio reutilizable y autocontenido, más
  relevancia para el área y título / fecha / participantes para reconocerla. El
  export de Claude meetings (ejemplo en `docs/Meeting Notes - Nov 20.md`) es un
  resumen con "Action items", "Summary" y "Claude's notes", sin año ni
  participantes: la fecha sin año se toma como la más reciente pasada y los
  participantes salen de los @. Se guarda como `borrador` con el texto completo y
  `MeetingReview` la revisa (título, fecha, editar / sacar / agregar criterios);
  "Sumar al cerebro" la pasa a
  `guardada` y cerrar sin guardar borra el borrador. "Lo que sabe"
  (tarjeta **"Criterios y aprendizajes"**, `brain-knowledge.tsx`; pedido: "más
  lindos, no todo texto, tipo bullets") muestra en "Criterios" los de todas las
  reuniones del área como bullets: cada criterio es `{ title, detail }` (título de
  3–7 palabras + la regla en una oración, con el porqué), con la reunión y fecha de
  origen; en "Reuniones", de dónde salieron, con Borrar (ConfirmDialog). Para que
  no quede "larguísima" (pedido): cada lista tiene alto fijo (420 px) con scroll
  propio (clase `q-scroll`, barra de Qualita), **solo se ven los títulos** (elegido
  entre opciones: solo títulos / por tema / chips / principios destilados; las
  otras quedan como idea) y al tocar uno se abre la regla con su origen, y la grilla va con
  `align-items: start` para no estirar la de criterios; la de **Cargar información sí se estira** al alto de la fila (`.brain-upload` con `align-self: stretch`, pedido: "que tenga el mismo alto que los criterios") y su contenido crece (zona de arrastre centrada, el texto pegado más alto). Las
  primeras reuniones guardaron cada criterio como texto suelto: `parseInsights`
  los lee como `detail` sin título.
  `drive_ids` marca en el calendario las "Ya cargadas".
- **De Notion** (2026-11-27, pedido: "tengo en notion una base de datos que es
  reuniones… en esas páginas están las transcripciones"; antes se descartó
  transcribir videos con Deepgram/AssemblyAI por ahora). Cuarta forma en
  `meeting-loader.tsx` (`NotionMode`, con buscador). La database es "Reuniones -
  Operaciones" (la otra "Reuniones" está vacía y sin fecha): se elige en
  `/admin/notion` (`NotionConfig.meetingsDataSourceId`) o, vacío, la primera con
  "reuni" en el nombre y una propiedad de fecha. Cada página es una nota de
  reunión de Notion AI: un bloque `meeting_notes` cuyo `children` trae
  `summary_block_id`, `notes_block_id` y `transcript_block_id` (cada uno un
  párrafo vacío con el texto en sus hijos; la transcripción no dice quién habla).
  `lib/brain-notion.ts`: lista los últimos 60 días por `created_time` (hasta 200);
  el título sale sin la mención de fecha que Notion AI le pega, la fecha de la
  propiedad Fecha o esa mención o `created_time`, participantes de las
  propiedades people, categoría del select. `POST /api/cerebros/interpretar` con
  `source: "notion"` y `pageId` lee el texto en el server **validando que la
  página sea de esa database** (el token ve todo el workspace).
- **Se elige la reunión entera, no sus partes** (2026-11-27, pedido: "se tendría
  que poder elegir la reunión en general, para calendario que elija solo 1 y
  para notion que elija la transcripción"; antes había checkboxes por documento
  / parte). Notion: solo la transcripción; si la página no tiene, resumen + notas
  + texto de la página (`readNotionMeeting`). Calendario: un documento,
  transcripción > notas de Gemini > el primero (`bestDoc` en `meeting-loader.tsx`;
  la ruta corta a uno). La fila dice qué documento se va a leer.
- UI de la carga de reuniones (mismo pedido: "mejorar la card, las scrollbars, un
  loader lindo, la search bar es horrible"): la fuente se elige con cuatro fichas
  con ícono (`.brain-sources`: Archivo, Pegar texto, Calendario, Notion).
  Calendario y Notion comparten `MeetingPicker`: buscador propio (`.brain-search`:
  lupa, contador de reuniones, borrar con ✕ o Escape, foco con anillo magenta) y
  lista `.brain-picks` con `q-scroll`, que llena el alto de la card (240–440 px):
  cada fila con la fecha en un cuadradito (día + mes), título, día de la semana /
  documento / participantes ("✓ Ya cargada" en verde al principio de esa línea) y
  el botón **Cargar** (pedido: "no sé si la palabra sería interpretar sino
  cargar al cerebro"; "Recargar", gris, si ya está), siempre visible y en su
  lugar: antes aparecía flotando al pasar el mouse y tapaba el texto. Mientras carga: `.brain-spinner` (anillo
  con el degradado que gira), puntos que laten y filas esqueleto con brillo
  (`brain-shimmer`); el spinner también en "Claude está interpretando" y al leer
  un archivo. Se guarda en `drive_ids` como
  `notion:<id>` (`notionRef`). Hace falta
  `docs/sql/2026-11-27-cerebros-reuniones-notion.sql` (suma `notion` al check
  de `source`).
- Áreas: `BRAIN_AREAS` en `lib/brains.ts` (clave, nombre, descripción, ícono,
  qué material le sirve). Sumar un área = una entrada ahí; el mapa reparte las
  tarjetas en dos columnas para cualquier cantidad.
- Mapa (`cerebros/brain-map.tsx`, client): coordenadas de 1600 × 900, pero se
  muestra solo la franja `VIEW` (y 140–760, 1600 × 620; pedido: "arriba de la
  sección hay mucho espacio vacío") con el cerebro más chico (580 de ancho) y las
  tarjetas entre y 220 y 680. `.brain-map` (aspect-ratio) y `.brain-core`
  (porcentajes) en globals.css dependen de `VIEW` y `BRAIN`: cambiar los dos
  juntos. El mapa va **centrado verticalmente** en el alto que queda debajo de
  las solapas (`.brains-view` flex con `justify-content: center`, mínimo 40 px
  arriba; pedido: "un poco más de espacio arriba, que quede centrado"). **Sin
  título, descripción ni contadores arriba** (pedido). En el centro un **cerebro
  anatómico de perfil**: la lámina del Gray's Anatomy (1918) vectorizada en
  Wikimedia Commons, **dominio público** (`cerebros/brain-art.ts`, con el origen
  anotado; sin los colores de los lóbulos ni las referencias). Se dibuja en línea
  suave con el degradado de marca y **destellos que recorren un tercio de los
  surcos** todo el tiempo (se aceleran con una tarjeta activa), con el **isotipo de
  Qualita** (`/qualita-isotipo.png`) en un círculo al medio. Fue la opción C de
  cinco sobre ese dibujo (línea, volumen, destellos, partículas, regiones que se
  encienden). Antes se descartaron dibujos hechos a mano (vista desde arriba con
  lóbulos, perfil con surcos inventados) y otros generados (surcos de ruido,
  nube de puntos, low-poly): "no se ve real". Los puntos de entrada de las
  fibras (`ENTRY`) se midieron sobre el contorno real. Cada tarjeta se une al
  cerebro con una **fibra limpia** (`fiber`): sale de un puerto (anillo con punto)
  apenas afuera del borde de la tarjeta, curva con manijas proporcionales a la
  distancia (fijas hacían un rulo en la tarjeta del medio) y al llegar al
  contorno **sigue por los surcos reales que pasan cerca** (`BRAIN_ROOTS` en
  brain-art.ts: 2–3 tramos por punto de entrada, medidos sobre los surcos con
  Chrome headless, hasta ~120 unidades hacia el centro), con un empalme suave y
  un punto que late al final de cada tramo (pedido: "que se conecten más
  armónicamente con las líneas dentro del cerebro"; antes era un abanico de
  raíces genéricas). Una señal brillante (tramo de `stroke-dasharray` con
  `pathLength` 1000) recorre la fibra y sigue por el tramo más largo hasta
  adentro del cerebro. Si cambian `ENTRY` o el dibujo, hay que volver a medir
  `BRAIN_ROOTS`. Las fibras van **encima** del
  cerebro (`.brain-links` con z-index 1) y debajo de las tarjetas (z-index 2).
  Antes hubo: curvas punteadas con puntos, "cuentas" de mielina y neuronas con
  cuerpo y dendritas a mitad de la línea ("raras ahí en medio"). Al pasar por
  una tarjeta se enciende su fibra y el resto se atenúa. Las tarjetas miden 23%
  con `box-sizing: border-box`; `LEFT_ANCHOR` (432 = 27% de 1600) es su borde y
  tiene que cambiar con ese ancho. ≤ 1180 px: sin fibras, cerebro arriba y
  tarjetas en grilla.
- Para revisar el dibujo sin levantar la app: renderizar `BrainMap` con jiti +
  `react-dom/server` a un HTML con `globals.css` y sacarle captura con Chrome
  headless (así se ajustó).
- Pantalla de un área (`cerebros/[area]/page.tsx`): volver + saltar a otra área,
  encabezado con fuentes (reuniones + archivos) / reuniones / archivos (pedido;
  antes era skills; archivos cuenta 0 hasta que se guarden),
  "Lo que sabe", "Cargar información" (`brain-uploader.tsx`: reunión, archivos o
  nota) y abajo dos tarjetas: Reuniones automáticas (próximamente) y la **Skill**.
- **Skill descargable** (2026-11-26, pedido: "armar la parte de generar el skill descargable"): `BrainSkillCard` (`[area]/brain-skill.tsx`) → `POST /api/cerebros/skill` → `generateBrainSkill` (`lib/brain-skills.ts`, tarea de IA `cerebro`, consumo `cerebro`): Claude escribe un **SKILL.md** (formato Agent Skills: frontmatter `name` = `qualita-<área>` y `description` con cuándo usarla; cuerpo en rioplatense con "Cómo trabajamos" por tema, "Antes de entregar" en checklist y "Cuando hay dudas") **solo con los criterios guardados** del área (con su fecha: si se contradicen, gana el más reciente; sin nombres de personas, clientes ni reuniones). Hacen falta al menos `MIN_SKILL_CRITERIA` (3). Cada generación es una versión nueva en `intranet_brain_skills` (`docs/sql/2026-11-26-cerebros-skills.sql`, RLS sin políticas) con cuántos criterios y reuniones usó; la tarjeta muestra la última (vN, fecha) y, comparando `criteria_keys` (huella de cada criterio, `criterionKey`) con los de hoy, avisa "Desde esta versión: N criterios nuevos y M borrados" (editar uno cuenta como los dos). Una sola skill por área: generar de nuevo la reescribe entera con todos los criterios vigentes; lo instalado en Claude no se actualiza solo. Descargas en el navegador (pedido: el botón principal baja el **.md**): "Descargar .md" baja `SKILL.md`; "Ver" abre el SKILL.md en un modal con cómo instalarlo y "Descargar .zip" (`qualita-<área>/SKILL.md`, `lib/zip.ts`, zip sin comprimir hecho a mano, probado con Expand-Archive), que es lo que pide Claude (Configuración → Capacidades → Skills).
- Estilos: bloque "Cerebros internos de Qualita" al final de `app/globals.css`
  (clases `brain-*` / `brains-*`).
