---
paths:
  - "lib/drive*.ts"
  - "**/drive/**"
  - "**/guias/**"
---

# Drive

(Movido desde CLAUDE.md: se carga solo al trabajar con estos archivos.)
- Pestaña Drive (`/clientes/[slug]/drive` y `/mi-empresa/drive`, misma `DriveView`,
  área `clientes`): la carpeta de cada cliente, **en vivo** (no se espeja). El estudio
  **no usa una unidad compartida**: son carpetas sueltas (de clientes o del equipo)
  compartidas como editor con `GOOGLE_DRIVE_USER` (env; hoy ulises@). Integración
  provider `drive`, `account_ref` = id de la carpeta, elegida en
  `/clientes/[slug]/drive/conectar` (desde "Compartido conmigo", "Mi unidad", unidades
  compartidas o buscando por nombre; no se puede elegir la raíz de un Drive entero).
  Subir por los padres de una carpeta compartida termina en un 404 (padres que la
  cuenta no ve): `pathFrom` lo toma como fin del camino. `lib/drive.ts` (API),
  `lib/drive-access.ts` (qué cliente y qué raíz según la sesión: la cuenta del
  cliente siempre la suya, el equipo por slug con RLS). **Regla de seguridad**: todo
  id que llega se valida con `isInside(raíz, id)`, que sube por los padres. Se puede
  ver, descargar y subir; **no** borrar ni crear carpetas. Descarga por dos rutas con
  el mismo código (`lib/drive-download.ts`): `/api/drive/[fileId]?cliente=` (equipo) y
  `/mi-empresa/drive/archivo/[fileId]` (cliente; proxy.ts no lo deja salir de
  `/mi-empresa`). Los Docs/Slides se exportan a PDF y los Sheets a xlsx. La subida
  va del navegador directo a Google con una sesión reanudable que abre el server
  (`createDriveUpload`, con el `Origin` para el CORS), tope 1 GB, y queda en la
  descripción quién subió. Migración: `docs/sql/2026-09-30-drive-provider.sql`.
  La vista (`drive-browser.tsx`) imita Google Drive: ruta, buscador en la carpeta,
  cuadrícula (carpetas + archivos con miniatura) o lista ordenable; la vista elegida
  va en `localStorage("drive-view")`. Las miniaturas no validan la carpeta en cada
  pedido: `DriveView` firma un link por archivo con HMAC (`lib/drive-thumb.ts`,
  clave derivada de `GOOGLE_SERVICE_ACCOUNT_KEY`, vence a la hora redondeada) y
  `/api/drive/thumb/[token]` o `/mi-empresa/drive/thumb/[token]` solo verifican la firma.
- Solapa **Guías** (`/clientes/[slug]/guias` y `/mi-empresa/guias`, misma `GuiasView`):
  videos tutoriales de las plataformas del cliente. **No es otra integración**: es
  una carpeta elegida **dentro** de la carpeta de Drive del cliente, guardada en
  `intranet_clients.guides_folder` (`docs/sql/2026-10-30-carpeta-guias.sql`;
  `getAllClients` la lee con fallback si falta la columna). Se elige en
  `/clientes/[slug]/guias/conectar`, que navega solo desde la raíz de Drive;
  `setGuidesFolder` valida `isInside(raíz de Drive, carpeta)`. Al cambiar o
  desvincular la carpeta de Drive, `guides_folder` vuelve a null (así siempre queda
  adentro). La cuenta del cliente ve la solapa solo con Drive vinculado y carpeta
  elegida. Comparte todo con Drive vía `DriveSource` (`"drive" | "guias"`) y
  `sourceRoot()` en `lib/drive-access.ts`: `getDriveAccess(slug, source)`,
  `serveDriveFile(…, source)` (`/api/drive/[fileId]?cliente=&de=guias`). Solo lectura:
  no hay subida. Los videos se reproducen en un modal con `<video>` contra
  `/api/drive/video/[token]` o `/mi-empresa/guias/video/[token]`: token HMAC propio
  (`videoToken`, clave distinta a la de miniaturas, vence a las 6 h redondeadas) y
  `fetchMediaRange` reenvía el Range a Google en tramos de 4 MB, así ninguna
  respuesta pasa el video entero por la función. Duración:
  `videoMediaMetadata.durationMillis` (`DriveItem.durationMs`).
