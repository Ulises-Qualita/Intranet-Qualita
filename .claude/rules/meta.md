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
- **Analizar plataforma** (solapa META, solo equipo con área `meta`; GADS pendiente).
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
