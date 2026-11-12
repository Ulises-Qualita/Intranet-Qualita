---
paths:
  - "lib/meta*.ts"
  - "app/api/integraciones/meta/**"
  - "**/meta/**"
  - "lib/analysis/**"
  - "components/analysis/**"
  - "app/api/analisis/**"
---

# Meta

(Movido desde CLAUDE.md: se carga solo al trabajar con estos archivos.)
- Meta: se conecta por cliente con login de Facebook (`app/api/integraciones/meta/start` →
  `callback` → `/clientes/[slug]/meta/conectar` para elegir portfolio y cuenta publicitaria).
  El token de usuario de larga duración (~60 días) va en `intranet_integration_secrets`
  (provider `meta`) y `account_ref` guarda el `act_…`. Graph API en `lib/meta.ts`. Env:
  `META_APP_ID`, `META_APP_SECRET`, opcionales `META_LOGIN_CONFIG_ID`, `META_GRAPH_VERSION`.
- **Analizar plataforma** (solapas META y GADS, solo equipo con área `meta`; lo de Google Ads está en `.claude/rules/google-ads.md`).
  **Desactivada por defecto**: la prende un admin en Administración → Funciones en
  prueba (`lib/features.ts`, fila `features` de `intranet_settings`, clave
  `platformAnalysis`; la franja, el endpoint, la pantalla y la acción lo chequean).
  Franja `components/analysis/analysis-bar.tsx` arriba de las métricas con el botón
  (`analyze-button.tsx`, modal con **solo los 3 pasos**: el razonamiento de Claude
  no se pide ni se muestra, salía en inglés y con doble scroll; a pedido) →
  `POST /api/analisis` → `lib/analysis/generate.ts`. Usa el **período elegido en la
  solapa**. `lib/analysis/meta-data.ts` lee **en vivo** (no se guarda) campañas,
  conjuntos (segmentación resumida, presupuesto, optimización, aprendizaje) y
  anuncios (texto, título, CTA) con su rendimiento del período, el anterior por
  campaña, la evolución semanal (desgaste) y cortes por edad/sexo, ubicación y
  dispositivo; si el usuario ve el CRM, las ventas por anuncio (`withMetaAdNames`).
  Tope de 60 anuncios (los de más gasto + los activos). Los detalles por id se piden
  filtrando `act_…/ads|adsets|campaigns` por `id IN`: **`?ids=` lo rechaza la API
  nueva**. `lib/analysis/ai.ts`: structured outputs; tarea `analisis` en
  `/admin/gastos` (sin esfuerzo elegido usa `high`), consumo `analisis`. Las
  recomendaciones que apuntan a un nombre que no existe en la cuenta se descartan
  (`checkTargets`). Si hay un análisis anterior, va en el contexto
  (`analisisAnterior`) para el seguimiento. Se guarda en
  `intranet_platform_analyses` / `intranet_platform_recommendations`
  (`docs/sql/2026-10-15-analisis-plataforma.sql`); la pantalla
  `/clientes/[slug]/meta/analisis` (`components/analysis/analysis-view.tsx`) muestra
  lectura, lo que funciona, la lista para tildar (hecha / descartada, con quién y
  cuándo; `components/analysis/actions.ts`) y los análisis anteriores (`?id=`).
- **Criterio de pauta** (Administración → `/admin/criterio`, 2026-11-12): textos
  escritos y archivos (PDF, Word, txt/md/csv, imágenes) por plataforma (Meta y Google
  Ads) que Claude recibe en cada análisis antes del contexto (`criteriaBlocks` de
  `lib/ad-criteria.ts`, como bloques `document`/`image`; tope de 15 MB de adjuntos),
  con la regla de seguirlo y decir cuándo los datos piden apartarse. Tabla
  `intranet_ad_criteria` + bucket privado `intranet-ad-criteria`
  (`docs/sql/2026-11-12-criterio-pauta.sql`). La subida va del navegador a Storage con
  URL firmada; después `criterionUploaded` extrae el texto de Word (`mammoth`) y de
  los de texto y lo guarda en `content` (Claude no lee .docx); PDF e imágenes se
  bajan y se mandan tal cual. Cada uno se puede pausar. Lo ve el área admin, lo
  cambia el rol admin (`app/(app)/admin/criteria-actions.ts`, UI en
  `criteria-admin.tsx`). La RLS deja leer también al área META, que corre el análisis.
- **Videos con mejor rendimiento** (solapa META, debajo de "Campañas y anuncios";
  pedido para Arteplac): la misma card de videos de la solapa CRM (`TopVideos` con
  `by="sales"`), con `topMetaVideos` de `lib/data.ts`. Hasta 3: primero los videos
  con ventas atribuidas en el CRM (ganadas por fecha de venta, `crmPeriod(...).ads`
  + `withMetaAdNames`), por ventas, facturado y menor gasto; los lugares que quedan
  se completan con los de mejor CPL de Meta, sin repetir (pedido: que no quede un
  solo video). Las ventas entran si el cliente tiene CRM y quien mira lo ve
  (`seesCrm`: área `crm` en el equipo; en `/mi-empresa`, que la solapa CRM no esté
  oculta para el cliente); si no, la card va solo por CPL y sin ventas ni facturado.
  La card "Videos con mejor rendimiento" de la solapa CRM usa el mismo criterio
  (antes iba por oportunidades del CRM, `topVideoAds`, que se borró); el texto de
  la aclaración sale de `topVideosHint` (`crm/top-videos.tsx`).
