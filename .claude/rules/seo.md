---
paths:
  - "lib/search-console*.ts"
  - "**/seo/**"
  - "docs/sql/*search-console*"
---

# Google Search Console (solapa SEO)

- Solapa SEO (`/clientes/[slug]/seo`, área `clientes`, **solo equipo**: no está en
  `client-zone.ts` ni en `/mi-empresa`; en `CLIENT_TABS` va con `client: null`).
  Desde el 2026-11-27 usa **Google Search Console**; SE Ranking se dejó de usar
  (pedido del usuario) y se borró `lib/seranking.ts`. Las filas viejas con provider
  `seranking` quedan en la base, la app ya no las lee.
- Conexión: la cuenta de servicio de `lib/google.ts`, scope
  `https://www.googleapis.com/auth/webmasters.readonly`. Con
  `GOOGLE_SEARCH_CONSOLE_USER` impersona a ese usuario (delegación de dominio, el
  scope tiene que estar en admin.google.com junto a los demás); sin esa variable
  actúa como sí misma (`googleAccessToken(null, …)`) y hay que sumar su email como
  usuario en cada propiedad. Además la API "Google Search Console API" tiene que
  estar habilitada en el proyecto de Cloud de las credenciales (si no, 403
  `SERVICE_DISABLED`, con mensaje propio en `searchConsoleErrorMessage`).
- Cada cliente se vincula a una propiedad: provider `search_console`,
  `account_ref` = `siteUrl` tal cual lo da la API (`sc-domain:ejemplo.com` o
  `https://www.ejemplo.com/`), elegida en `/clientes/[slug]/seo/conectar`
  (`connectSearchConsoleSite` valida que esté en la cuenta; se preselecciona la que
  coincide con `client.website`). Migración del CHECK de `provider`:
  `docs/sql/2026-11-27-search-console-provider.sql`.
- Datos (`getSearchConsoleReport`, cacheado 3 h con `GSC_TAG`, que descarta el
  botón Actualizar): usa el **período del encabezado** (`/seo` está en
  `PERIOD_TABS`; sin `loading.tsx`). Se pide `dataState: "all"` y el período se
  corta en el último día con datos, para compararlo contra los mismos días del
  período anterior (`previousPeriod` del período cortado). Totales y posición
  promedio salen de las filas por día (posición ponderada por impresiones). Además:
  búsquedas (1000) y páginas (500) del período y del anterior (para el cambio de
  posición), dispositivos, países (alfa-3, `countryName`) y sitemaps (si fallan,
  la solapa sigue). Search Console guarda 16 meses.
- Las búsquedas anónimas no vienen por consulta: la suma de la tabla es menor que
  el total; la vista muestra qué parte de los clics falta si es ≥ 5 %.
- Al 2026-11-27 no se pudo probar contra datos reales (faltaba habilitar la API y
  el scope): verificar el formato de las respuestas la primera vez que ande.
