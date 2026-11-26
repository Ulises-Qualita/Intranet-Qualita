---
paths:
  - "lib/report/**"
  - "**/reportes/**"
  - "app/api/reportes/**"
---

# Reportes

(Movido desde CLAUDE.md: se carga solo al trabajar con estos archivos.)
- Pestaña Reportes (`/clientes/[slug]/reportes`, solo equipo, área `clientes`): genera
  un HTML con el diseño de `docs/DML_reporte_mensual_5.html` para el período elegido
  (máx. 90 días atrás, lo que guardan Meta y el CRM). `lib/report/data.ts` junta Meta,
  Google Ads, CRM y Clarity (cada parte es null si no hay datos y la sección se omite;
  Google Ads sin conectar figura como pendiente). La pauta suma Meta y Google Ads, y
  como en la referencia las conversiones de Google cuentan como sus leads (con
  decimales); `lib/report/ai.ts` pide a Claude los textos con structured
  outputs (registra consumo en `intranet_agent_usage`); `lib/report/html.ts` renderiza
  en el server con el CSS copiado tal cual en `lib/report/styles.ts`. La generación
  (`lib/report/generate.ts`) corre en `POST /api/reportes` por SSE: manda los pasos y
  el razonamiento resumido de Claude, que el modal de la solapa muestra en vivo. Se guarda en
  `intranet_client_reports` (`docs/sql/2026-09-28-reportes.sql`) y se sirve desde
  `/api/reportes/[id]` con CSP `sandbox`. "Modificar" en el historial abre un chat
  (`POST /api/reportes/[id]/editar`, SSE; `lib/report/edit.ts`): Claude recibe el HTML
  sin las imágenes base64 (marcadores `__IMG_n__`) y devuelve reemplazos exactos
  `find → replace` que se aplican todo o nada (reintenta hasta 2 veces si un fragmento
  no coincide; se rechaza código ejecutable). Guarda la versión anterior en
  `previous_html` para deshacer un nivel (`docs/sql/2026-09-28-reportes-edicion.sql`). La migración de reportes también agrega
  `intranet_leads.stage_changed_at` (Odoo `date_last_stage_update`, para el tiempo de
  respuesta) e `intranet_clarity_daily.sources` (origen del tráfico, de `ReferrerUrl`).
- Reportes comparativos y cargados a mano (`docs/sql/2026-11-26-reportes-comparativos.sql`:
  `kind` generado/manual/comparativo, `metrics`, `file_path`, `file_name`,
  `compared_ids`, `html` opcional y bucket privado `intranet-client-reports`).
  Cada reporte guarda sus números en `metrics` (`lib/report/metrics.ts`,
  `fromReportData`): el comparativo compara contra **lo que decía cada reporte
  guardado**, no recalcula (pedido del usuario), así sirve para meses de más de 90
  días. Diseño: `docs/Reporte_Bimenstral_Comparativo.pdf` (el mensual con
  "▲ x% vs Septiembre / vs Agosto" debajo de cada número). En el formulario, modo
  "Comparativo" propone los reportes de los **dos meses anteriores** (el más nuevo
  de cada mes, con números) y se pueden cambiar; `POST /api/reportes` recibe
  `compare` (ids), `generateReport` los carga (`loadPeers`) y `renderReport(data,
  texts, peers)` agrega las líneas con `makeCompare` (`lines` / `inline`; cada
  número dice si mejorar es subir, bajar o ninguna; participaciones en p.p.;
  campañas, canales, vendedores y origen del tráfico se cruzan por nombre). Claude
  recibe los números anteriores en `comparacion` para los textos. Sin peers, el
  HTML queda igual que antes. Carga a mano ("Cargar un reporte", `manual-report.tsx`):
  PDF o HTML hasta 20 MB, del navegador a Storage con URL firmada
  (`createReportUpload`), `POST /api/reportes/importar` hace que Claude saque los
  números (`lib/report/import.ts`, structured outputs con `METRICS_SCHEMA`) y el
  equipo los revisa en `MetricsEditor` antes de guardar (`saveManualReport`); si
  cancela, el archivo se borra. Una vez guardados, los números no se editan desde
  el historial (se sacó el botón "Números" a pedido, 2026-11-26): los generados
  antes de la migración no tienen y no se pueden elegir para comparar; hay que
  generarlos de nuevo o subirlos como reporte manual. `/api/reportes/[id]` sirve el archivo de un manual (PDF sin
  CSP sandbox: el visor no abre así). "Modificar" no aplica a los manuales.
