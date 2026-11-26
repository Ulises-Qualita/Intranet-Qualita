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
- Estado: **solo interfaz** (pedido: "empecemos por la interfaz, no hace falta que
  funcione"). No hay tablas ni bucket: los contadores muestran 0 reales y la carga
  deja lo elegido en pantalla como "Sin guardar", con el aviso de que no está
  conectada. No inventar fuentes ni datos de muestra.
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
  encabezado con fuentes / reuniones / skills, "Lo que sabe" (vacío por ahora),
  "Cargar información" (`brain-uploader.tsx`: archivos o nota) y dos tarjetas de lo
  que viene: Reuniones (por definir) y Skills (próximamente).
- Estilos: bloque "Cerebros internos de Qualita" al final de `app/globals.css`
  (clases `brain-*` / `brains-*`).
