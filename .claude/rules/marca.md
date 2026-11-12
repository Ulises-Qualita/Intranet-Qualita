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
  va sobre ese color. **No se elige el fondo a mano** (se
  sacó: el usuario no lo quiere). Los ejemplos aplicados usan el logo que mejor se
  lee sobre el color principal.
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
  muestra una tira de fotos. El panel (solapa "Aplicaciones"), elegido por el usuario: las
  de redes en Instagram en una computadora (`SocialMockups`: el perfil de
  escritorio dentro de un monitor, con publicaciones, seguidores, seguidos,
  nombre, rubro, bio y web; **sin** barra del navegador, barra lateral de
  Instagram ni botones Seguir / Enviar mensaje: que se lea como una forma de
  mostrar las piezas, no como un Instagram real (pedido); historias = las verticales < 0,7 que
  avanzan solas, grilla, posteo abierto en una ventana con me gusta). El perfil
  sale de Meta si el cliente lo tiene conectado (`getInstagramProfile` en
  lib/meta.ts, con el token de anuncios: `promote_pages` →
  `instagram_business_account` trae bio y web; si no, `instagram_accounts` trae
  usuario, foto y números; 6 h en memoria; `instagramFor` en brand-view); si no,
  solo nombre, rubro y web del cliente, sin números inventados. No se lee
  instagram.com (lo bloquea y va contra sus condiciones). Y las otras
  aplicaciones sobre una mesa de trabajo (`WorkTable`: arrastrar, doble clic para
  ampliar, Ordenar / Desparramar). Se probaron y se sacaron un carrusel 3D y el celular (con y sin la computadora al lado). Ampliar abre `Lightbox` (su propio
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
- Logo principal: `data.logo.main` (id del recurso, `setMainLogo`, botón "Marcar
  como principal"); sin elegir, el que se llama "Principal" (Claude pone primero
  el principal, el de la portada, y lo nombra así) o el primero subido. El bloque
  del tablero muestra siempre el principal, sobre su fondo automático.
- Pendiente / ideas: logo vectorial (SVG) desde el PDF, miniaturas de las páginas del PDF, y que el agente o los reportes usen la marca.
