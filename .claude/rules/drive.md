---
paths:
  - "lib/drive*.ts"
  - "**/drive/**"
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
