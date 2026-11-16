---
paths:
  - "**/marca/**"
  - "lib/brand*.ts"
  - "app/api/marca/**"
  - "docs/sql/*manual-de-marca*"
---

# Manual de marca

- Solapa "Manual de marca" de cada cliente (2026-11-12, referencia visual del
  usuario: endform.studio). Equipo: `/clientes/[slug]/marca` (área `clientes`); la
  cuenta del cliente: `/mi-empresa/marca`, misma `BrandView` con `internal={false}`
  (solo ver y descargar). **Arranca apagada para el cliente**: `CLIENT_DEFAULT_OFF`
  en `lib/client-tabs.ts` (se guarda `hidden_tabs.clientShown` cuando alguien la
  prende en Editar cliente → Solapas; `applyTabChange` arma lo que se guarda).
- Flujo: el PDF va del navegador al bucket privado `intranet-brand` con URL firmada
  (`createBrandUpload` → `brandPdfUploaded`, tope 115 MB, igual en el bucket; el límite global de Storage del proyecto tiene
  que ser igual o mayor) y enseguida
  `POST /api/marca/extraer` (ruta, no Server Action, por el tiempo; `maxDuration`
  300) corre `extractBrandBook` de `lib/brand.ts`: Claude lee el PDF (hasta 24 MB en
  base64; más pesado por la Files API, que se borra al terminar) y devuelve con
  structured outputs paleta, tipografías, logo, tono e imágenes (`BrandData` en
  `lib/brand-shared.ts`, normalizado por `normalizeBrand`). Tarea de IA `marca` en
  `/admin/gastos` (sin esfuerzo elegido, `medium`) y consumo `marca` en
  `intranet_agent_usage`. `checkGoogleFonts` marca qué familias existen en Google
  Fonts (la hoja de estilos responde 400 si no).
- Vista (tercera versión, 2026-11-12; las dos anteriores, un documento largo y un
  "hub" editorial, no le gustaron al usuario: "parece un documento", "muy IA",
  quiere UX/UI interactiva con poco texto). Se probó también una estructura de
  app con menú lateral y una sección por vez; **eligió el tablero** y pidió
  mejorarlo. **Tablero bento**
  (`brand-board.tsx`, client) con bloques de logo, paleta, cada tipografía, tono,
  "Aplicada", PDF y recursos. Los tamaños los calcula el componente según lo que
  tiene la marca (variables CSS `--c`/`--r` en 12 columnas, `--mc`/`--mr` en el
  celular) para que no queden huecos; la paleta se copia en el mismo bloque. Cada
  bloque abre un panel (`Sheet`, dialog, con pestañas y ← → para pasar de
  sección) con su
  herramienta: colores que se copian (HEX / RGB / CMYK / Pantone; RGB y CMYK se
  calculan del HEX si el manual no los trae) + combinaciones con contraste WCAG
  (`contrast`, `contrastGrade`); probador de tipografía (texto, tamaño, peso);
  logo sobre fondos (claro, oscuro, colores de la marca) con descarga y reglas
  plegadas; tono (palabras grandes, sí / no); ejemplos aplicados (posteo, tarjeta,
  web, historia 9:16) con "Otra combinación". El usuario pidió probar todas las herramientas y
  sacar después las que no gusten. `brand-view.tsx` (server) resuelve fuentes y
  URLs firmadas: Google Fonts con una hoja por peso (`googleFontCss(family,
  weight)`: un peso inexistente rompe la hoja entera), fuentes subidas por
  `@font-face`. Una fuente subida se une a su familia por el nombre del archivo
  (`fontKey`). Las herramientas del equipo van en una barra fina arriba
  (`AdminBar`): editar datos (`saveBrandData`), volver a leer, reemplazar o
  borrar el PDF.
- Tablas `intranet_brand_books` (una por cliente) e `intranet_brand_assets`
  (`docs/sql/2026-11-12-manual-de-marca.sql`, ya con la política restrictiva de
  clientes asignados). Las URLs firmadas se arman en el server al renderizar
  (2 h los recursos, 1 h el PDF).
- Logos del PDF (`logo-from-pdf.tsx`): al leer el manual Claude también marca
  dónde está cada versión del logo (`data.logo.sources`: página y caja en fracciones
  de la página). **Se guardan solos al leer**: si el cliente no tiene logos, `/api/marca/extraer` devuelve las cajas y el link al PDF, y `runExtraction` (brand-ui) los recorta y sube con `saveLogosFromPdf` (al volver a leer con logos ya cargados no se duplican). El panel "Sacar del PDF" queda para ajustar o sumar. Para manuales leídos antes, `POST /api/marca/logos`
  (`locateBrandLogos`) busca solo eso, sin pisar las correcciones. El navegador
  dibuja la zona con **pdf.js** (`pdfjs-dist`, worker con `new Worker(new URL(...))`,
  se carga solo al abrir), recorta al borde y, si el fondo es liso (las 4 esquinas
  iguales), lo vuelve transparente separando el color del fondo. Se ajusta
  arrastrando sobre la página y se guarda como logo PNG con `uploadFile`. El
  editor conserva `sources` (`...data.logo`).
- Fondo de cada logo (`logo-tone.ts`): el navegador lee los colores reales de la
  imagen (canvas, `crossOrigin`; Storage manda CORS) y `bestBackground` elige el
  primero donde se lee (contraste 3+ del 85% del logo) en este orden: blanco, color
  principal, los otros de la marca, casi negro. Una imagen con fondo propio (JPG)
  va sobre ese color. **El equipo puede elegir el fondo a mano** (2026-11-16,
  pedido: el automático ponía sobre blanco logos pensados para fondo negro; antes
  se había sacado). Botón "Fondo" en cada logo del panel (`LogoBackgroundPicker`
  en brand-ui, popover con blanco, negro, los colores de la marca, otro color y
  "Automático"); se guarda en `data.logo.backgrounds` (id del recurso → hex,
  `setLogoBackground`) y gana sobre el automático en `logoBackground`. Volver a
  leer el manual y el editor conservan `backgrounds` y `main`. Los ejemplos
  aplicados usan el logo que mejor se lee sobre el color principal.
- Panel del logo: **mosaico bento asimétrico** (`logoLayout`, tamaños por cantidad):
  principal 7×4, a la derecha 5×2 y debajo 3 + 2, el resto de a dos (6×2). Las
  variantes de una misma familia (primera palabra, p. ej. los dos monocromos) se
  ordenan al final para caer en filas de dos iguales. El "iso…" (isologotipo /
  isotipo) va más chico en su bloque (clase `small`). Se probaron y no gustaron:
  uno simétrico (familias en la columna derecha) y otro según la forma de cada
  logo (compactos al costado). La imagen ocupa el bloque con
  `object-fit: contain` (con `max-height` en % se cortaba), cada una sobre su fondo automático,
  nombre abajo, descarga redonda y (equipo) "Marcar como principal" / "Borrar" al
  pasar el mouse. Se probaron y no gustaron: tira de miniaturas, lista al costado,
  lámina, pastillas con nombres y carrusel.
- **Aplicada con piezas reales** (pedido: "más real", los manuales siempre traen
  aplicaciones y ejemplos para redes): al leer el manual Claude también marca
  `data.applications` (página, caja, nombre, `kind` "redes" | "aplicacion"). El
  navegador las recorta tal cual (JPG, sin quitar fondo, `saveApplicationsFromPdf`
  en logo-from-pdf.tsx), las sube a `{clientId}/aplicacion/` con
  `createBrandUpload(…, "aplicacion")` y `saveBrandApplications` guarda la lista
  con el `path` de cada imagen (no son filas de `intranet_brand_assets`: no
  aparecen en Recursos y no hizo falta migración). Volver a leer conserva las ya
  recortadas. **Es automático, no opcional** (pedido): en un manual leído antes
  (`data.applications` undefined) el tablero del equipo las saca solo al abrirse
  (`useAutoApplications` → `extractApplications`: `/api/marca/aplicaciones`,
  `locateBrandApplications`, esfuerzo bajo; una vez por carga de página); si no
  hay ninguna se guarda `[]` para no volver a buscar. "Volver a sacar del PDF" en
  el panel las reemplaza y borra las imágenes viejas. El editor no las toca (`saveBrandData`
  conserva las guardadas) y borrar el manual borra sus imágenes. Vista: el bloque
  muestra un abanico de hasta 5 piezas enteras (`bb-real-fan`: alterna
  aplicaciones y redes, el alto sale de la suma de proporciones `--sum` para que
  entren sin recortar; antes era una tira de fotos recortadas sobre negro) con
  el mismo fondo de la mesa y la cantidad de piezas. El panel (solapa "Aplicaciones"), elegido por el usuario
  (2026-11-13): **solo la mesa de trabajo**, con todas las piezas juntas
  (`WorkTable`: cada pieza entera y sin marco, en filas del mismo alto que
  calcula `arrange` según el tamaño de la mesa para que ninguna se corte; clic
  la amplía, se arrastran, Ordenar / Desparramar, fondo con un tinte del color
  principal y filtro Todas / Redes / Otras si el manual trae
  de las dos). Se sacó el Instagram dentro de un monitor que mostraba las de redes
  (`SocialMockups`, con el perfil leído de Meta: `getInstagramProfile` también se
  borró). Se probaron y se sacaron antes un carrusel 3D y el celular. Ampliar abre `Lightbox` (su propio
  `<dialog>`, imagen con `max-height` en `dvh`). No gustaron: bento con recorte,
  mosaico y ver las páginas del PDF con las piezas marcadas (se sacó; quedó
  `applicationPages` solo para limpiar esas imágenes). Sin piezas
  reales quedan las piezas de muestra generadas.
- Redes = **un posteo o historia por caja** (`APPS_VERSION` 2 en brand-shared):
  antes Claude marcaba la composición entera y en el mockup un "posteo" eran
  varios. `data.applicationsVersion` guarda el criterio; una lista de un criterio
  anterior cuenta como no buscada y el tablero del equipo la vuelve a sacar sola
  (y al volver a leer el manual no se conserva). El recorte se ajusta al borde de
  la pieza si el fondo alrededor es liso (`trimToContent` en logo-from-pdf.tsx).
- Nitidez de las aplicaciones (2026-11-13, "se ve borrosa"): las fotos dentro del
  PDF suelen ser chicas (en Arteplac, 1 px por punto: un posteo mide 211×264) y
  pdf.js las agranda **sin suavizar** si pasan de 1,33× (`getImageSmoothingEnabled`),
  así que a 1800 px salían pixeladas. `imageDensity` (logo-from-pdf.tsx) recorre
  los operadores de la página y da los px por punto de las fotos de esa zona;
  `cropApplication` recorta a esa resolución (texto y vectores siguen a 1800 px).
  `APPS_VERSION` 3 hace que las ya guardadas se vuelvan a sacar solas. La vista
  grande (`Lightbox`) agranda cada imagen hasta 2,2 veces su tamaño real
  (`img.sized`, variables `--nw` / `--ar`), suavizada por el navegador. Más
  nitidez solo con un PDF exportado con mejores imágenes. El nombre de cada pieza
  va en blanco sobre un degradado oscuro: `--navy` es claro en el tema oscuro y
  con texto blanco no se leía.
- Más datos en el tablero (2026-11-13, "le falta info", pedido: sin que parezca
  mucho texto; el usuario lo quiere probar y puede pedir volver atrás: el estado
  anterior quedó en el stash "base manual de marca"). Todo sale de lo ya extraído,
  sin volver a leer el PDF: en el bloque del logo, área segura y tamaño mínimo
  (`logoSpecs` los saca de las reglas; si no hay, quedan las palabras del tono;
  el área segura va con un dibujito y en palabras, "1x libre alrededor · x = ancho
  de la forma a", porque "1x · Área segura" no se entendía);
  y una fila nueva entre el tono y las aplicaciones con **Jerarquía** (nombre en
  la tipografía de títulos + primera frase del resumen en la de texto + tamaños
  H1/H2… de `headingSizes`, que los lee de `usage` de las fuentes), **Estilo
  visual** (temas de `data.imagery` con `styleNotes`, sobre el color de acento;
  abre un panel propio `estilo` con una tarjeta por pauta, que antes iban
  plegadas en Tono). Cada uno abre **su propio panel** (pedido: Jerarquía abría
  Tipografía sin mostrar la jerarquía): `jerarquia` (`HierarchyPanel`: cada nivel
  a su tamaño real con textos de la marca, y el uso de cada fuente). Hubo un
  tercer bloque, **No hacer** (prohibiciones cortas, con panel "Sí y no"): el
  usuario pidió quitarlo; las reglas siguen plegadas en Logo y en Tono. Cada bloque aparece solo
  si el manual trae el dato y se reparten el ancho (`extraSpan`).
- Panel Estilo visual = explorador por tema (2026-11-13, pedido: "son todas
  cards, algo más visual e interactivo"). `styleTopics` arma los temas: cada pauta
  con título ("Fotografía: …") más las que le siguen sin título. A la izquierda la
  lista de temas; a la derecha el elegido con su **muestra real del manual** (clic
  = `Lightbox`, miniaturas si hay varias). Sin muestra propia, tres **piezas del
  manual** como ejemplo (redes primero, distintas por tema, rotuladas "Piezas del
  manual"; pedido: "ejemplos en vez de la card naranja"); la pauta en grande sobre
  el color de acento queda solo si el manual no tiene piezas. Las muestras son recortes del PDF con `kind: "estilo"` en
  `data.applications` (fotos de ejemplo, íconos, kit UI; `name` = el tema), que
  salen en la misma llamada que las aplicaciones (`APPS_VERSION` 4; hasta 28 en
  total) y se emparejan con su tema por nombre (`stems`); una sin tema arma el
  suyo. El tablero las separa: `realApps` (mesa, abanico) no las incluye. El
  equipo puede quitar una muestra mal recortada desde el panel.
- Logo principal: `data.logo.main` (id del recurso, `setMainLogo`, botón "Marcar
  como principal"); sin elegir, el que se llama "Principal" (Claude pone primero
  el principal, el de la portada, y lo nombra así) o el primero subido. El bloque
  del tablero muestra siempre el principal, sobre su fondo automático.
- Pendiente / ideas: logo vectorial (SVG) desde el PDF, miniaturas de las páginas del PDF, y que el agente o los reportes usen la marca.
