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
  el mapeo sin perder datos.
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
  de cada turno, nunca los resultados de las tools). Modelo por defecto
  `claude-opus-5`, override con `ANTHROPIC_MODEL`. El render del chat soporta un
  markdown acotado (`components/agent/rich-text.tsx`): sin tablas, y el prompt lo
  dice. `lib/agent/usage.ts` registra tokens y costo estimado por consulta en
  `intranet_agent_usage` (precios por millón en una tabla del módulo; el costo se
  guarda ya convertido para que las filas viejas no cambien de valor), y alimenta
  las cards de gasto de `/admin`.
- Foro (`/foro`, solapa del sidebar sin área propia, como el agente): mensajes con
  tipo (error/mejora/pregunta), estado y respuestas, en `intranet_forum_posts` /
  `intranet_forum_comments`. **Una sola pantalla**, sin ruta por mensaje:
  `getThreads()` trae todo (dos consultas y el cruce en memoria) y el acordeón de
  `forum-list.tsx` despliega cada uno sin pedir nada. `lib/forum-shared.ts` es el
  modelo client-safe. El **estado solo lo mueve un admin**, y eso no se puede
  expresar con RLS (una política no ve el valor anterior de la fila): va como
  trigger `forum_status_guard_intranet`.
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

### Skills del proyecto

`.agents/skills/` contiene skills instaladas (ver `skills-lock.json`):
`frontend-design`, `vercel-react-best-practices` (reglas en `rules/*.md`) y
`web-design-guidelines`. Leer el `SKILL.md` correspondiente al trabajar en UI o
rendimiento de React.
