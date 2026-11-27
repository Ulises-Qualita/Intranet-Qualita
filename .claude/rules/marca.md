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
  (`createBrandUpload` → `brandPdfUploaded`, tope del PDF 40 MB desde 2026-11-16 porque con 115 MB los pesados no cargaban; el bucket admite 115 MB por los recursos; el límite global de Storage del proyecto tiene
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
  va sobre ese color. **Los fondos no se eligen a mano** (2026-11-26, pedido: "en
  el manual ya están establecidos los permitidos para cada logo"; se sacó el
  botón "Fondo" / `LogoBackgroundPicker` / `setLogoBackground` que había del
  2026-11-16). `locateLogoBackgrounds` (lib/brand.ts, `POST /api/marca/fondos`,
  esfuerzo bajo) le pasa a Claude los logos subidos (id + nombre) y guarda los
  fondos que el manual permite para cada uno en `data.logo.allowed` (id → HEX en
  orden; `[]` = el manual no lo define y va el automático). El tablero del equipo
  lo llama solo (`useAutoFetch`, una vez por carga) cuando hay logos sin
  entrada (`backgroundsPending`): cubre manuales leídos antes y logos subidos
  después. `logoBackground` usa el permitido (si hay varios, el primero donde se
  lee). Volver a leer el manual y el editor conservan `allowed` y `main`. Los
  ejemplos aplicados usan, entre los logos permitidos sobre el color principal,
  el que mejor se lee ahí.
- Panel del logo: **mosaico bento asimétrico** (`logoLayout`, tamaños por cantidad):
  principal 7×4, a la derecha 5×2 y debajo 3 + 2, el resto de a dos (6×2). Las
  variantes de una misma familia (primera palabra, p. ej. los dos monocromos) se
  ordenan al final para caer en filas de dos iguales. El "iso…" (isologotipo /
  isotipo) va más chico en su bloque (clase `small`). Se probaron y no gustaron:
  uno simétrico (familias en la columna derecha) y otro según la forma de cada
  logo (compactos al costado). La imagen ocupa el bloque con
  `object-fit: contain` (con `max-height` en % se cortaba), cada una sobre su fondo del manual,
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
- Calidad de las imágenes (2026-11-26, "se ven en muy mala calidad"): **reemplaza lo de `imageDensity`** del punto anterior (se borró). Recortar a la resolución de la foto dejaba textos y vectores borrosos. Ahora `withSmoothing` (logo-from-pdf.tsx) intercepta mientras pdf.js dibuja el `imageSmoothingEnabled = false` del prototipo de `CanvasRenderingContext2D` (lo fuerza a true, calidad high) y lo restaura al terminar; con eso se recorta todo a 2400 px de lado largo (`APP_LONG_SIDE`, hasta 8×; logos 2000 px) y las fotos chicas se agrandan suaves, no pixeladas. JPG 0,93. `CROP_VERSION` (2) en brand-shared y `data.applicationsCrop`: las aplicaciones guardadas con un recorte anterior las vuelve a recortar solo el tablero del equipo (`useAutoRecrop` → `saveApplicationsFromPdf(…, recrop = true)`), con las mismas cajas, sin Claude; si una falla queda la imagen vieja. Los logos ya subidos no se rehacen solos (se pueden volver a sacar del PDF). **Límite real: la resolución de las fotos dentro del PDF.** Los 3 manuales cargados (2026-11-26) traen todas las fotos a 1 px/pt (72 ppp; un posteo de Follow: 243×324 px), así que se ven borrosas igual; la solución es subir el manual exportado en alta (200–300 ppp, sin reducir imágenes). El usuario descartó mejorarlas con IA (super resolución). `brandPdfUploaded` borra `applicationsCrop` al reemplazar el PDF, así las imágenes ya recortadas se rehacen solas desde el PDF nuevo con las mismas cajas (sirve si es el mismo manual reexportado). Ojo con el tope de 40 MB del PDF.
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
  a su tamaño real con textos de la marca, y el uso de cada fuente; el equipo
  cambia los textos con "Editar textos", en el lugar y con la misma tipografía,
  y se guardan en `data.hierarchy` con `saveHierarchyTexts`: uno por nivel, "" o
  igual al automático = automático; el bloque del tablero usa el primero y el
  texto; volver a leer y el editor los conservan). Hubo un
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
  total) y se emparejan con su tema por nombre (primero nombre igual al tema, `plain`; si no, `stems`: un nombre corto como "Kit UI" no deja raíces de 4 letras y armaba un tema repetido); una sin tema arma el
  suyo. El tablero las separa: `realApps` (mesa, abanico) no las incluye. El
  equipo puede quitar una muestra mal recortada desde el panel.
- Reglas de uso del logo (2026-11-26, pedido: "mucho texto", bullets y segmentado): `LogoRules` en el panel del logo, ya no plegadas. **Acordeón por tipo** (elegido entre opciones: dos columnas sí / no, fichas con solo títulos, medidas arriba + chips; antes se probaron solapas y "quedó medio raro"). Tipos por palabras (`ruleGroup`): Medidas (título + números en pastillas), No hacer (sin el "No", ✕ roja; la regla entera en el `title`), Fondos y color, Otros usos y Versiones (la descripción, una oración por bullet). Uno abierto por vez, arranca el primero; solo aparecen los tipos con algo. Para que el panel no salte al cambiar de tipo, `LogoRules` corrige el scroll de `.bb-sheet-body` y deja el encabezado tocado donde estaba (`useLayoutEffect`), y el cuerpo del panel tiene `scrollbar-gutter: stable` (la barra que aparece o desaparece corría todo).
- Jerarquía, **"Todos juntos"** (2026-11-26, pedido: ver cómo conviven los tamaños con un ejemplo): es **lo único que muestra el panel** (pedido: "mostremos directamente todos juntos", sin "nivel por nivel" ni título): la escala nivel por nivel aparece solo al tocar "Editar textos", con los campos. `HierarchyTogether` arma una composición con los mismos textos (con 4 niveles el más chico va de volanta; después título, bajada, texto y los demás como subtítulos de sección con su párrafo). Formato **Página** (tamaños reales) o **Pieza** (sobre el color principal, a 0,62; alto según el contenido: con 4:5 quedaba mucho vacío arriba) y "Marcar niveles" (el nivel y sus px al costado; en la pieza, encima con borde punteado). No se muestra mientras se editan los textos.
- Panel Tono (2026-11-26, pedido: "mucho texto", con ejemplos de cómo hablar de la marca): palabras grandes, la descripción como bajada chica, **"Así habla la marca"** (chips con situaciones; por cada una la frase en la tipografía de títulos, "Así no:" y Copiar frase; rótulo "Del manual" o "Sugerido según el tono") y el sí / no en bullets. Los ejemplos son `data.voice.examples` (`VoiceExample`: context, good, bad, manual): salen en la lectura del manual (`VOICE_EXAMPLES`; es lo único donde Claude puede escribir frases propias, marcadas `manual: false`) o, en manuales leídos antes, solos al abrir el tablero del equipo (`useAutoFetch` → `POST /api/marca/tono`, `locateVoiceExamples`, esfuerzo bajo; `[]` si no salió nada). El editor los conserva. `useAutoFetch` es el mismo hook que busca los fondos de los logos.
- Recursos por categoría (2026-11-26, pedido: "filtrarse por iconografía, tramas, etc"): `RESOURCE_CATEGORIES` en brand-shared (Iconografía, Tramas y texturas, Recursos gráficos, Ilustraciones, Fotografía, Mockups, Plantillas, Tipografías, Otros). Sin elegir, `guessCategory` la saca del nombre del archivo (las fuentes, Tipografías); el equipo la cambia con el selector de cada tarjeta (`CategorySelect` → `setResourceCategory`, se guarda en `data.resources`, id → categoría; sin migración). El panel Recursos (`FilesPanel`) abre con chips Todos / cada categoría con su cantidad (solo las que tienen algo, y solo si hay más de una). Volver a leer el manual y el editor conservan `resources`.
- Recursos sacados del PDF (2026-11-26, pedido: "en estilo visual hay muchas cosas que deberían estar en recursos", p. ej. en Follow Huella, Gradientes/tags, Iconografía, Emojis; eligió "sale entero, pauta en Recursos"). `APPS_VERSION` 5: en la misma llamada de aplicaciones Claude marca los elementos gráficos sueltos con kind **"recurso"** y `category` (iconos, tramas, graficos, ilustraciones; "ninguna" en el resto). Se recortan como el logo (`cropLogo`: PNG al borde, fondo liso transparente) y viven en `data.applications` (no son filas de `intranet_brand_assets`). En el tablero, `styleTopics` arma los temas con las muestras y los recursos: un tema con un recurso sale de Estilo visual (`styleList`) y su pauta pasa a Recursos (`ResourceGuide`), que se muestra arriba al filtrar esa categoría. `FilesPanel` muestra esos recursos primero (fondo a cuadros, clic = Lightbox, descarga PNG, el equipo los borra con `DeleteApplicationButton`) y los cuenta en los chips.
- Sacar las piezas solo tarda (2026-11-26): Claude ~45 s y después el navegador recorta ~30 imágenes (1–2 min). Sin aviso el usuario recargaba, se cortaba y cada recarga volvía a llamar a Claude (6 lecturas de 78k tokens en 4 min, ninguna guardada). Ahora `locateBrandApplications` guarda lo de Claude en `data.applicationsDraft` ({ version, items }) y, si hay uno de la versión actual, lo devuelve sin llamarlo (salvo `fresh`, que manda el botón "Volver a sacar del PDF"); `saveBrandApplications` lo borra. Mientras corre (`appsPending` con piezas ya en pantalla, o `useAutoRecrop`) el tablero muestra el aviso fijo `.bb-updating`: "Actualizando las piezas del manual… No cierres ni recargues la página".
- Sets de recursos separados (2026-11-26, "no se cargaron por separado, sino todo junto"): `cropResourcePieces` (logo-from-pdf.tsx) dibuja la zona y `splitPieces` la corta en cruz por franjas de un solo color (filas, después columnas, recursivo; hueco mínimo `minGap` = 2,5% del lado corto, así no parte un mismo ícono), saca el texto pegado debajo de cada ícono (`dropLabel`) y los textos sueltos. **Solo separa si es un set**: 4 o más piezas y el 80% de tamaño parecido; una lámina mezclada (la de la Huella, con tarjetas y títulos) o pocas piezas (los tags) van enteras. Cada pieza se guarda como un recurso propio (`Nombre 1`, `Nombre 2`…, con su caja con aire en la página, así recortarla de nuevo da esa pieza sola), PNG con fondo transparente. Probado con los íconos de Follow (15 + 15, sin textos) y los emojis (30). `CROP_VERSION` 3 hace que lo ya guardado se rehaga solo. Tope de `applicationSources` subido a 200.
- Logo principal: `data.logo.main` (id del recurso, `setMainLogo`, botón "Marcar
  como principal"); sin elegir, el que se llama "Principal" (Claude pone primero
  el principal, el de la portada, y lo nombra así) o el primero subido. El bloque
  del tablero muestra siempre el principal, sobre su fondo del manual.
- Pendiente / ideas: logo vectorial (SVG) desde el PDF, miniaturas de las páginas del PDF, y que el agente o los reportes usen la marca.
