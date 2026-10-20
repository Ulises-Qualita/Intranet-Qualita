---
paths:
  - "lib/google-ads*.ts"
  - "**/gads/**"
  - "docs/sql/*google-ads*"
---

# Google Ads

(Movido desde CLAUDE.md: se carga solo al trabajar con estos archivos.)
- Google Ads (solapa GADS, `/clientes/[slug]/gads`, área `meta`; la cuenta del cliente la ve en `/mi-empresa/gads`, misma `GadsView` con `internal={false}`, y lee sus campañas con `docs/sql/2026-10-19-google-ads-cliente-campanas.sql`). La conexión
  es con la misma cuenta de servicio de Calendar y Drive (`lib/google.ts`, scope
  `https://www.googleapis.com/auth/adwords` en la delegación de dominio), sin OAuth por
  usuario. Env: `GOOGLE_ADS_LOGIN_CUSTOMER_ID` (MCC; se aceptan guiones, el header
  `login-customer-id` los saca), `GOOGLE_ADS_USER` (usuario a impersonar), opcionales
  `GOOGLE_ADS_DEVELOPER_TOKEN` y `GOOGLE_ADS_API_VERSION` (default `v25`). Desde el
  2026-09-10 el nivel de acceso no lo da el developer token (opcional, la API lo ignora)
  sino el **proyecto de Cloud** de las credenciales: `intranet-qualita`. El "Explorer"
  del Centro de API de la MCC es de otro proyecto del equipo. El 2026-10-07 ya lee
  cuentas reales (listado de la MCC y métricas). `lib/google-ads.ts`: `gaql()` (search
  paginado), `listAdsAccounts()` / `getAdsAccount()` (solo cuentas bajo la MCC, sin
  MCCs) y los mensajes de los errores de configuración. Por cliente: provider
  `google_ads`, `account_ref` = customer id de 10 dígitos, elegido en
  `/clientes/[slug]/gads/conectar` (`connectGoogleAdsAccount` valida que cuelgue de la
  MCC; migración `docs/sql/2026-10-07-google-ads-provider.sql`). Métricas como Meta:
  `lib/google-ads-sync.ts` (en el cron y, como refuerzo, al abrir la vista con
  `prepareGadsView`) guarda `intranet_gads_daily` (cuenta por día) e
  `intranet_gads_campaigns` (campaña por día; `docs/sql/2026-10-07-google-ads.sql`,
  RLS: equipo con área `meta`). Backfill de `GADS_HISTORY_DAYS` = 182 días (la API
  tiene todo el historial, así el período de 90 también se compara), después se
  reescriben los últimos 14. `synced_at` / `sync_error` van en
  `intranet_integration_secrets` (provider `google_ads`, sin credenciales). Montos en
  la moneda de la cuenta, sin convertir; las conversiones traen decimales. Cambiar o
  desvincular la cuenta borra lo guardado (`clearGadsData`). La vista
  (`gads/gads-view.tsx`) usa el período del encabezado (`/gads` en `PERIOD_TABS`):
  gasto, costo por conversión, conversiones, clics, CTR y CPC contra el período
  anterior, tabla de campañas y gasto diario. La **inversión** que se muestra en
  lugares generales es Meta + Google Ads: Vista general (KPI "Nivel de inversión" y
  "Recorrido de la inversión", donde los leads también suman las conversiones de Google
  y todos los costos usan la inversión total; la card "Leads generados" también
  suma las dos), la columna de Inicio
  (`getGadsSpendByClient`) y el reporte. La cuenta del cliente lee sus totales
  diarios para la Vista general (`docs/sql/2026-10-07-google-ads-cliente.sql`) y,
  desde 2026-10-19, también las campañas. Falta llevarlo al agente.
