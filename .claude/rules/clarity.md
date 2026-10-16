---
paths:
  - "lib/clarity*.ts"
  - "**/web/**"
  - "app/api/cron/**"
  - "docs/sql/*clarity*"
---

# Clarity (solapa WEB)

(Movido desde CLAUDE.md: se carga solo al trabajar con estos archivos.)
- Clarity (solapa WEB de cada cliente, `/clientes/[slug]/web`, área `clientes`): la
  Data Export API permite **10 consultas por proyecto por día** y solo devuelve las
  últimas 72 h, así que **no se consulta al abrir la vista**: el cron toma una foto
  diaria (solo en la corrida de la mañana; dos se solaparían) y la serie se acumula
  en `intranet_clarity_daily` / `intranet_clarity_pages`. **El historial anterior a
  la conexión no se puede traer**, y la API solo da números (sin heatmaps ni
  grabaciones). `lib/clarity.ts` (API + secrets), `lib/clarity-sync.ts`. Ojo:
  la doc de Microsoft solo detalla los campos de la métrica `Traffic`; el parser
  prueba nombres candidatos y guarda la respuesta cruda en `raw` para poder corregir
  el mapeo sin perder datos. Los nombres de campo no son consistentes en mayúsculas
  (`distinctUserCount`, `pagesPerSessionPercentage`): se leen sin distinguirlas. La
  respuesta general ya trae `Device`, `ReferrerUrl` y `PopularPages`, así que la foto
  diaria es **una sola consulta** (`parseClarityDay`; los cortes por dimensión volvían
  vacíos). `docs/sql/2026-09-28-clarity-recalculo.sql` recalcula los días viejos desde `raw`.
- Fricción (rage clicks, clics muertos, etc.): el número es **`subTotal`** de cada
  métrica (`FRICTION_FIELDS` en `lib/clarity.ts`), sin adivinar otro campo. Cada fila
  trae también `sessionsCount`, que es el **total de sesiones del día** (igual en
  todas): leerlo hacía que todas las cards mostraran el mismo número. `readField` busca
  los candidatos **en orden de prioridad** (antes tomaba el primer campo de la fila
  que coincidiera con alguno, y Clarity manda `sessionsCount` primero). Los días
  guardados se corrigen desde `raw` con `docs/sql/2026-09-28-clarity-recalculo.sql`
  (el 2026-10-16 se corrieron las 38 filas).
