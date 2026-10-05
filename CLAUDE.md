# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

---

## Notas para Claude Code (complementan AGENTS.md)

### Comandos

```bash
npm run dev      # servidor de desarrollo (http://localhost:3000)
npm run build    # build de producción
npm run start    # sirve el build
npm run lint     # ESLint 9 (flat config: eslint-config-next core-web-vitals + typescript)
npx tsc --noEmit # chequeo de tipos
```

No hay framework de tests configurado todavía.

### Estado real del repo (vs. lo planificado en AGENTS.md)

- Versiones: **Next.js 16.3**, **React 19.2**, **Tailwind CSS v4** (vía
  `@tailwindcss/postcss`, sin `tailwind.config`), TypeScript, `@supabase/ssr`.
- **No usar datos placeholder.** Lo que todavía no tiene tabla o integración se muestra
  como "Pendiente" / "No conectado" (`EmptyState`, `KpiLocked`, `ConnectState` en
  `components/ui.tsx`).
- Auth (login Google, solo `@qualita.studio`), con el dominio validado en tres lugares:
  - `proxy.ts`: refresca la sesión (`getClaims`) y redirige a `/login`.
  - `app/auth/callback/route.ts`: canjea el code y cierra la sesión si el dominio no es válido.
  - `app/(app)/layout.tsx`: segunda barrera, más la pantalla "Cuenta sin acceso" si el
    perfil no existe o está inactivo.
- Permisos: `lib/auth.ts` (`getSession` memorizado por request, `getAreaSession(area)`)
  + `lib/auth-shared.ts` (`canAccess`, `AREAS`; sin imports de server, usable en proxy
  y cliente). Cada página valida su área y renderiza `<NoAccess />` si no corresponde.
- Esquema real en Supabase (ya creado, más amplio que AGENTS.md): `intranet_clients`
  (slug usado en las URLs `/clientes/[slug]`), `intranet_client_integrations`
  (provider/connected), `intranet_client_assignments`, `intranet_tasks`,
  `intranet_meta_daily`, `intranet_meta_ads`, `intranet_crm_snapshot`, `intranet_leads`,
  `intranet_integration_secrets`; RPC `intranet_is_admin`, `intranet_has_area`.
  Inspeccionar columnas vía el OpenAPI de PostgREST antes de asumir nombres.
- Logos de clientes: bucket público `intranet-client-logos` (PNG/JPG/WebP, 2 MB), un
  objeto por cliente con nombre = `client.id`, sin columna en la tabla. La subida va del
  navegador a Storage con una URL firmada (`createLogoUpload` en
  `app/(app)/clientes/actions.ts`); constantes en `lib/logos.ts`.
- Datos: todo sale de Supabase vía `lib/data.ts` (nada se guarda en el front salvo el
  tema en `localStorage`). Clientes, tareas, métricas Meta, snapshot CRM y leads se leen
  con la sesión del usuario (RLS). `getTeam()` usa service_role (llamar solo después de
  validar acceso). Formato es-AR en `lib/format.ts`. Si una tabla no tiene filas, se
  muestra un estado "Sin datos"; nunca valores inventados.
- Escrituras: Server Actions en `app/(app)/clientes/actions.ts` y
  `app/(app)/admin/actions.ts`, con el cliente de sesión para que RLS vuelva a validar.
  Excepción: `addMember` usa service_role para crear el usuario en Auth, porque Auth es
  compartido con el otro app.
- Meta: se conecta por cliente con login de Facebook (`app/api/integraciones/meta/start` →
  `callback` → `/clientes/[slug]/meta/conectar` para elegir portfolio y cuenta publicitaria).
  El token de usuario de larga duración (~60 días) va en `intranet_integration_secrets`
  (provider `meta`) y `account_ref` guarda el `act_…`. Graph API en `lib/meta.ts`. Env:
  `META_APP_ID`, `META_APP_SECRET`, opcionales `META_LOGIN_CONFIG_ID`, `META_GRAPH_VERSION`.
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
- Notion: fuente de verdad de las **tareas**, en **solo lectura** y **en vivo** (no se
  espeja en Supabase). Integración *interna* del workspace: un único `NOTION_TOKEN` (env,
  server), no OAuth por cliente. Dos niveles de config:
  - Global, en `/admin/notion` → fila `notion` de `intranet_settings`: qué data source es
    Proyectos y cuál Tickets, y el mapeo de propiedades (estado → las 3 columnas,
    prioridad, responsable, vencimiento, relación a Proyecto). Se elige desde la UI, no
    está hardcodeado.
  - Por cliente, en `/clientes/[slug]/notion/conectar` → `intranet_client_integrations`
    con provider `notion` y `account_ref` = page id del proyecto. Un proyecto por cliente;
    los tickets de proyectos sin cliente se ignoran.
  - `lib/notion.ts` (API, solo server), `lib/notion-map.ts` (traducción pura, client-safe),
    `lib/tasks.ts` (modelo de tarea, client-safe). Desde la versión `2025-09-03` de la API
    las databases contienen *data sources* y el query es
    `POST /v1/data_sources/{id}/query`: consultar los docs, no ir de memoria.
  - Cache: una sola query trae los tickets de todo el estudio (la DB de Tickets es única).
    Se cachea solo esa query cruda con `unstable_cache` (60s, tag `notion-tickets`), porque
    `getTasks()` corre en `app/(app)/layout.tsx` en cada render. El mapeo ticket → cliente
    va fuera del cache, por request, para respetar la RLS. `"use cache"` no se usa: exige
    activar `cacheComponents` en todo el proyecto. Invalidación con
    `revalidateTag(tag, { expire: 0 })` — en Next 16 la forma de un solo argumento está
    deprecada.
  - Si Notion falla, `getTasks()` nunca tira: devuelve las tareas de Supabase y el motivo
    en `notionError`, que la vista de Tareas muestra como aviso.
- Agente: dos vistas del mismo componente (`components/agent/agent-conversation.tsx`)
  — la burbuja de `app/(app)/layout.tsx` y la pantalla completa `/agente`, que es
  también una solapa del sidebar (sin área propia: aparece con cualquiera
  habilitada). El botón de expandir pasa el hilo por `?hilo=`, que la página lee en
  el server. Backend: `POST /api/agente` con SSE. `ANTHROPIC_API_KEY` solo en el server; el modelo no recibe datos en el
  prompt, los pide con tools. `lib/agent/tools.ts` envuelve `lib/data.ts` y **la
  lista de tools es el control de acceso**: se arma por request con `canAccess`, así
  que un área sin habilitar no existe para el modelo (y adentro la RLS vuelve a
  validar porque leen con la sesión del usuario). `lib/agent/prompt.ts` (system
  prompt cacheado, estable en toda la conversación), `lib/agent/threads.ts`
  (historial en `intranet_agent_threads` / `intranet_agent_messages`, solo el texto
  de cada turno, nunca los resultados de las tools). Modelo y esfuerzo por uso
  (agente / reportes) los elige un admin en `/admin/gastos` (fila `ai` de
  `intranet_settings`; `lib/ai-models.ts` client-safe, `lib/ai-config.ts` server);
  sin elegir, `ANTHROPIC_MODEL` y si no `claude-opus-5-5`. Solo modelos con thinking
  adaptativo y `effort` (Haiku 4.5 no). El loop cachea también los mensajes
  (`cache_control` arriba de todo) para que los resultados de tools reenviados en
  cada vuelta se cobren como lectura de caché; `crm_leads` tiene tope de 50. El render del chat soporta un
  markdown acotado (`components/agent/rich-text.tsx`): sin tablas, y el prompt lo
  dice. `lib/agent/usage.ts` registra tokens y costo estimado por consulta en
  `intranet_agent_usage` (precios por millón en una tabla del módulo; el costo se
  guarda ya convertido para que las filas viejas no cambien de valor), y alimenta
  las cards de gasto de `/admin/gastos`. La misma tabla registra todo el consumo de IA,
  separado por `kind` (`agente` | `reporte` | `analisis`, lista en `USAGE_KINDS`;
  `docs/sql/2026-09-28-uso-por-tipo.sql`): `recordUsage(kind, …)` y `getAiUsage()`,
  y `/admin/gastos` muestra un bloque por tipo.
- Administración en solapas con ruta propia, en el grupo `app/(app)/admin/(tabs)/`:
  `/admin` (Usuarios y accesos), `/admin/cuentas` (Cuentas de clientes, solo rol
  admin) y `/admin/gastos`. Mismo esquema que el panel del cliente: el `layout.tsx`
  del grupo dibuja el `Topbar` y la barra (`admin-tabs.tsx`, con las clases
  `client-tabbar` / `client-tab`), las páginas no dibujan `Topbar` y el `loading.tsx`
  usa `TabSkeleton`. `/admin/notion` queda fuera del grupo. Las acciones de cuentas
  revalidan `/admin/cuentas`.
- Foro (`/foro`, solapa del sidebar sin área propia, como el agente): mensajes con
  tipo (error/mejora/pregunta), estado y respuestas, en `intranet_forum_posts` /
  `intranet_forum_comments`. **Una sola pantalla**, sin ruta por mensaje:
  `getThreads()` trae todo (dos consultas y el cruce en memoria) y el acordeón de
  `forum-list.tsx` despliega cada uno sin pedir nada. `lib/forum-shared.ts` es el
  modelo client-safe. El **estado solo lo mueve un admin**, y eso no se puede
  expresar con RLS (una política no ve el valor anterior de la fila): va como
  trigger `forum_status_guard_intranet`.
- Puesto (`intranet_profiles.job_title`, `docs/sql/2026-09-26-perfil-puesto.sql`):
  texto libre que define el admin en `/admin` (Diseñador/a, Project manager…), **solo
  para mostrar**; los permisos siguen siendo `role` + `areas`. `getTeam()` lo expone
  como `jobTitle` y selecciona `*` para no romper si la columna todavía no existe.
- Pestaña Equipo de cada cliente (`/clientes/[slug]/equipo` y `/mi-empresa/equipo`,
  misma `EquipoView`): los miembros activos de `intranet_client_assignments`, vía
  `getClientTeam()` con service_role (la cuenta del cliente no ve asignaciones ni
  perfiles por RLS).
- Pestaña Reuniones (`/clientes/[slug]/reuniones` y `/mi-empresa/reuniones`, misma
  `ReunionesView`, área `clientes`): reuniones de Google Calendar reconocidas por la
  nomenclatura `"<Cliente> & Qualita <motivo>"` (el nombre se compara con
  `client.name`, sin distinguir mayúsculas ni tildes). Se leen **en vivo** los
  calendarios de todo el equipo con una **cuenta de servicio con delegación de
  dominio** (env `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_KEY`; scope
  `calendar.events.readonly`, autorizado por un super admin en la consola de
  Workspace). `lib/calendar.ts`: como con Notion, se cachea solo la consulta de todo
  el estudio (`unstable_cache` 5 min, tag `calendar-meetings`) y el filtro por cliente
  va afuera. Ventana: 90 días atrás, 60 adelante. La cuenta del cliente no ve la
  descripción del evento; sin env, la solapa no aparece en `/mi-empresa`. La vista es
  mitad y mitad (`meetings-calendar.tsx`): el mes con las reuniones escritas en cada
  día y, a la derecha, las próximas como cards separadas por semana (fotos de Google
  del equipo cruzadas por mail con `getTeam`; los de afuera, iniciales). Tocando un
  día se ven sus reuniones; las pasadas llevan una descripción que escribe el equipo
  y la cuenta del cliente solo lee (además, en el Portal la database de Notion
  embebida suma una solapa "Reuniones" al lado de sus vistas, con un calendario solo
  de reuniones: `withExtraEvents` de `lib/notion-blocks.ts` las agrega a
  `db.extraEvents` fuera del cache y `buildCalendar(…, "extra")` lo arma; la vista
  calendario de Notion también las sigue mostrando, mezcladas con las filas, y la
  solapa no aparece si no hay reuniones o si la
  solapa Reuniones del cliente está desactivada): `intranet_meeting_notes` (clave = `Meeting.key`,
  `docs/sql/2026-09-30-reuniones-notas.sql`), `lib/meeting-notes.ts`,
  `saveMeetingNote` valida que la clave sea de una reunión pasada del cliente.
- Cuenta de servicio de Google: `lib/google.ts` (token por usuario + scope) la
  comparten Calendar y Drive. La delegación en admin.google.com tiene que tener los
  dos scopes: `calendar.events.readonly` y `drive` (al editarla se reemplaza la lista).
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
- Pestaña Reportes (`/clientes/[slug]/reportes`, solo equipo, área `clientes`): genera
  un HTML con el diseño de `docs/DML_reporte_mensual_5.html` para el período elegido
  (máx. 90 días atrás, lo que guardan Meta y el CRM). `lib/report/data.ts` junta Meta,
  CRM y Clarity (cada parte es null si no hay datos y la sección se omite; Google Ads
  figura como pendiente); `lib/report/ai.ts` pide a Claude los textos con structured
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
- Solapas por cliente: en "Editar cliente" → Solapas se activa o desactiva cada una,
  por separado para el equipo y para la cuenta del cliente (Vista general siempre se
  ve). Catálogo en `lib/client-tabs.ts`; se guardan las **ocultas** en
  `intranet_clients.hidden_tabs` (`docs/sql/2026-09-28-solapas-cliente.sql`), así una
  solapa nueva aparece activa sin migrar. `Client.hiddenTabs` filtra la barra de solapas del cliente (`app/(app)/clientes/[id]/layout.tsx`, arriba del contenido y con el selector de período, que es uno solo para todas las solapas y viaja en sus links) y
  `clientTabs()`, y cada solapa tiene un `layout.tsx` con `TeamTabGate` /
  `ClientTabGate` (`components/tab-gate.tsx`) para que no se pueda entrar por URL.
  Una solapa nueva del cliente tiene que sumarse a `CLIENT_TABS` (y a `CLIENT_NAV` del
  layout del cliente) y llevar ese layout.
- Panel del cliente (equipo): el encabezado (nombre, solapas, período) es de
  `app/(app)/clientes/[id]/layout.tsx` y no se desmonta al navegar; solo cambia lo de
  abajo. Reglas para no romperlo: ninguna página bajo `clientes/[id]` dibuja `Topbar`
  (las vistas compartidas con `/mi-empresa` lo hacen solo con `!internal`); los
  `loading.tsx` de ahí usan `TabSkeleton`; las solapas con período (Vista general,
  META, CRM) **no** llevan `loading.tsx` propio, porque `?dias=` lo reiniciaría y
  vaciaría la pantalla; por eso Vista general vive en `clientes/[id]/(general)/`. El
  período navega con `useTransition` y la vista anterior queda atenuada mientras carga.
  Cada solapa con fuente externa abre con `SyncStatus` (`components/sync-status.tsx`):
  punto verde/rojo/gris con la fuente y "Actualizado hoy a las 08:12 hs" (`syncedAt`
  de `lib/format.ts`, a partir de `synced_at`/`sync_error` de los secrets) o "En vivo"
  para Notion y Calendar. El detalle del error solo lo ve el equipo.
- Tablas que todavía no se crearon: chequear con `isMissingTable()` de
  `lib/supabase/server.ts`. PostgREST responde **`PGRST205`** (no la encuentra en su
  schema cache), no el `42P01` de Postgres; mirar solo uno deja el otro sin cubrir.
  `saveNotionConfig` en `app/(app)/admin/actions.ts` todavía compara contra `42P01`.
- Estilos: clases del mockup en `app/globals.css` (`@layer components`); tema oscuro =
  clase `.dark` en `<html>` + `localStorage("theme")`. Ojo con nombres de clase que
  choquen con utilidades de Tailwind (p. ej. `mb-16`).
- Alias de imports: `@/*` → raíz del repo.
- `docs/supabase-intranet-shared.sql` está referenciado en AGENTS.md pero **no está
  en el repo** — pedirlo al usuario antes de asumir el esquema exacto de SQL.
- `docs/qualita-intranet.html` es el mockup (fuente de verdad visual): extraer de ahí
  los tokens CSS (variables de tema claro/oscuro) al construir componentes.

### Next.js 16 — diferencias a tener presentes

- Consultar `node_modules/next/dist/docs/01-app/` antes de usar cualquier API.
- El antiguo `middleware.ts` ahora es **`proxy.ts`** en la raíz (ver
  `01-getting-started/16-proxy.md`). El refresco de sesión de Supabase SSR va ahí.
- `next.config.ts` fija `experimental.staleTimes` en 30 s (`dynamic` y `static`): el
  navegador reusa por 30 s las pantallas ya visitadas o precargadas. Un cambio hecho
  desde el cliente por una ruta `/api/…` (no por una Server Action) tiene que terminar
  con `router.refresh()`, o la pantalla puede mostrar el dato viejo al volver.
- Reuniones, solo equipo con el área `tareas`: al abrir en el calendario un día con
  una reunión que viene (`meetings-calendar.tsx`), su card muestra, ya desplegadas,
  las tareas abiertas del cliente (`getTasksResult()`: tickets de Notion + propias)
  que vencen ese día o antes, incluidas las vencidas. En la lista "Próximas
  reuniones" no aparecen. `ReunionesView` las manda todas en
  `prep` y cada card filtra por su día. Las abiertas sin vencimiento solo se cuentan.
  No depende de `SHOW_TASKS`. La cuenta del cliente no recibe `prep`.
- Comparación contra el período anterior (META y CRM): `previousPeriod()` de
  `lib/period.ts` da el período inmediatamente anterior del mismo largo, `compare()` de
  `lib/compare.ts` arma el cambio (cada métrica declara si mejorar es subir, bajar o
  ninguna: el gasto va sin color) y `Kpi` lo dibuja con `change` / `versus` en lugar de
  `sub`. Solo se compara si el período anterior está entero dentro de lo guardado
  (`getMetaFirstDate` en META; primera oportunidad y `CRM_HISTORY_DAYS` en CRM); si no,
  queda el texto de antes. En CRM se comparan Oportunidades y Ticket promedio, **no**
  Ganadas ni Total en tickets: todo se cuenta por fecha de creación y el período
  anterior tuvo más tiempo para cerrar ventas (para compararlas habría que guardar la
  fecha de cierre). Falta llevarlo a WEB y Vista general.
- Google Ads (solapa GADS, `/clientes/[slug]/gads`, solo equipo, área `meta`): por ahora un
  placeholder. La conexión es con la misma cuenta de servicio de Calendar y Drive
  (`lib/google.ts`, scope `https://www.googleapis.com/auth/adwords` en la delegación de
  dominio), sin OAuth por usuario. Env: `GOOGLE_ADS_DEVELOPER_TOKEN`,
  `GOOGLE_ADS_LOGIN_CUSTOMER_ID` (MCC, 10 dígitos), `GOOGLE_ADS_USER` (usuario a
  impersonar). Probado el 2026-10-01 contra la API v25: el token y
  `listAccessibleCustomers` responden, pero las consultas a cuentas reales dan
  `CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION` hasta que Google apruebe el acceso
  (se pide en el Centro de API de la MCC). Todavía no hay `lib/` que lea la API.
- Qué leads del CRM cuentan (contexto de Arteplac en `docs/contexto-kommo.md`): no todo
  lead es una consulta nueva. `crmExclusions` de `lib/crm-shared.ts` marca en el sync los
  que no cuentan y el motivo va a `intranet_leads.excluded`
  (`docs/sql/2026-10-02-crm-leads-base.sql`): `stage` (etapas excluidas, p. ej. "Equipo
  interno"), `before_start` (anteriores al día desde el que el registro es completo),
  `returning` (el contacto existía en el CRM más de un día antes que el lead: al conectar
  un WhatsApp, Kommo importa la agenda y cada cliente viejo que escribe nace como lead
  nuevo; se detecta con `contact_created_at`) y `duplicate` (mismo teléfono que un lead
  anterior; el teléfono no se guarda). `getLeads()` ya los deja afuera, así que vistas,
  agente y reportes quedan corregidos sin tocarlos; `getExcludedLeads()` alimenta el
  aviso de la solapa CRM (solo equipo). La fecha y las etapas se eligen por cliente en
  `/clientes/[slug]/crm/conectar` → "Qué leads se cuentan" (`since` y `excluded_stages`
  en los secrets del CRM). En Odoo solo aplican esas dos. Lo que **no** se resuelve: las
  ventas de Arteplac (etapa CONFIRMADO y "Presupuesto $") no son confiables en Kommo;
  la fuente oficial es su planilla, que la intranet no lee.
- Atención por chat en la solapa CRM (solo equipo, solo Kommo): `intranet_crm_chat_events`
  (`docs/sql/2026-10-01-crm-chats.sql`) guarda un registro por mensaje **sin el texto**,
  de la API de eventos de Kommo (`incoming_chat_message` / `outgoing_chat_message`).
  `lib/crm-chat-sync.ts` corre dentro de `syncCrmClient`: trae lo nuevo y completa
  hacia atrás hasta 30 días, 16 páginas por corrida (el cron tiene 60 s); un fallo ahí
  va a `secrets.chat_error`, no rompe el sync de oportunidades. `lib/crm-chats.ts`
  (`getChatEvents`, `chatStats`) y `crm/chat-monitor.tsx` arman el tiempo de la
  **primera respuesta por lead nuevo** del período (del primer entrante al primer
  saliente posterior, solo leads que cuentan; mediana con reloj corrido, separada
  según el lead haya escrito dentro o fuera del horario de atención, `WORK_HOURS`:
  lunes a viernes de 9 a 18, sin confirmar con Arteplac), respondidos en 15 min, sin
  respuesta y conversaciones esperando. No se mide cada ida y vuelta: daba 4 minutos
  por el ping-pong de charlas ya empezadas. Se
  agrupa por el **responsable del lead** y no por quién escribió: en Arteplac casi
  todos los salientes llegan sin usuario (`created_by` 0, responden desde la app de
  WhatsApp). El texto de los mensajes existe en `GET /api/v4/talks/{id}/messages`,
  pero pide el alcance "External chat history" (Chats API add-on) y hoy da 403.
- Portada e ícono del portal del cliente: no se usa la url firmada de Notion en el
  `<img>` (cambia en cada consulta y el navegador nunca la guarda). `PortalView` arma
  un link propio firmado con HMAC (`lib/notion-image.ts`, mismo esquema que las
  miniaturas de Drive) con una huella del archivo, y `/api/notion/img/[token]` o
  `/mi-empresa/portal/img/[token]` le piden a Notion un link vigente y devuelven la
  imagen con cache de un año. Las imágenes del cuerpo del portal siguen directas.
- Links de navegación (sidebar, solapas del cliente y de Administración): usar
  `NavLink` (`components/nav-link.tsx`), no `Link`. Precarga la pantalla entera al
  pasar el mouse, enfocar o tocar. Consecuencia: **una página se puede renderizar sin
  que nadie entre**, así que no debe tener efectos al renderizar. Solo corre en
  producción (`next build` + `next start`); en `npm run dev` Next no precarga.
- `npx tsc --noEmit` no sirve si `.next/types/validator.ts` quedó corrupto: con errores
  de sintaxis ahí, TypeScript no informa los de tipos del resto. `npx next build`
  regenera los tipos y hace el chequeo completo.
- Velocidad en local vs. producción: Supabase está en `us-east-1` y Vercel en `iad1`
  (misma región, ~10–40 ms por consulta). Desde Argentina cada consulta tarda ~250 ms,
  así que `npm run dev` siempre se siente más lento que producción.

### Skills del proyecto

`.agents/skills/` contiene skills instaladas (ver `skills-lock.json`):
`frontend-design`, `vercel-react-best-practices` (reglas en `rules/*.md`) y
`web-design-guidelines`. Leer el `SKILL.md` correspondiente al trabajar en UI o
rendimiento de React.
