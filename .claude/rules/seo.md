---
paths:
  - "lib/seranking*.ts"
  - "**/seo/**"
  - "docs/sql/*seranking*"
---

# SE Ranking (solapa SEO)

- Solapa SEO (`/clientes/[slug]/seo`, área `clientes`, **solo equipo**: no está en
  `client-zone.ts` ni en `/mi-empresa`; en `CLIENT_TABS` va con `client: null`).
- Una sola cuenta del estudio: la clave va en `SERANKING_API_KEY` (env, solo server).
  Con la misma clave andan las dos APIs (`lib/seranking.ts`):
  - **Project API** (rank tracker, `https://api.seranking.com/v1/project-management`,
    máx. 5 consultas por segundo, sin unidades): las keywords que sigue el proyecto,
    sus posiciones diarias (30 días), visibilidad (90 días), páginas indexadas,
    Domain Trust y los competidores del proyecto (una consulta por competidor, hasta
    8, de a cuatro). Se guarda una hora (tag `SERANKING_TAG`, que descarta el botón
    Actualizar).
  - **Data API** (`https://api.seranking.com/v1`): tráfico orgánico estimado,
    keywords orgánicas, historial mensual y backlinks del dominio. **Gasta unidades**
    (~100 por consulta, 3 por cliente): se guarda un día y Actualizar no la toca. La
    base regional (`source`) sale del buscador del proyecto (`sourceFor`, Argentina
    por defecto). En sitios nuevos devuelve vacío (`organic: []`).
- Cada cliente se vincula a un proyecto ("site"): provider `seranking`,
  `account_ref` = `site_id`, elegido en `/clientes/[slug]/seo/conectar`
  (`connectSeRankingSite` valida que esté en la cuenta). Migración del CHECK de
  `provider`: `docs/sql/2026-11-02-seranking-provider.sql`.
- Formato real de las respuestas (verificado el 2026-11-02): en `/sites/positions`,
  `pos: 0` = fuera del top 100 y `change` positivo = subió; en
  `/competitors/positions`, "fuera" llega como `pos: 100` con `url: null`. Números a
  veces como string. Los nombres de buscador salen de `/system/search-engines`
  (208 = Google Argentina). `today_avg` del resumen cuenta las que no rankean como
  100: la posición promedio se calcula solo con las que están en el top 100.
