# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

---

## Notas para Claude Code (complementan AGENTS.md)

Las notas de cada integración o solapa (Meta, Clarity, Notion, Agente, Foro,
Reuniones, Drive, Reportes, Google Ads, CRM, Portal/Hitos) están en
`.claude/rules/*.md` y se cargan solas al tocar los archivos de esa función.
Al documentar algo nuevo de una de ellas, agregarlo ahí y no acá.

### Comandos

```bash
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
- Administración en solapas con ruta propia, en el grupo `app/(app)/admin/(tabs)/`:
  `/admin` (Usuarios y accesos), `/admin/cuentas` (Cuentas de clientes, solo rol
  admin) y `/admin/gastos`. Mismo esquema que el panel del cliente: el `layout.tsx`
  del grupo dibuja el `Topbar` y la barra (`admin-tabs.tsx`, con las clases
  `client-tabbar` / `client-tab`), las páginas no dibujan `Topbar` y el `loading.tsx`
  usa `TabSkeleton`. `/admin/notion` queda fuera del grupo. Las acciones de cuentas
  revalidan `/admin/cuentas`. Cuentas de clientes: "Ver acceso" muestra la contraseña
  actual a pedido; Auth guarda solo el hash, así que la intranet guarda una copia
  cifrada (AES-256-GCM, `lib/client-passwords.ts`, tabla sin políticas
  `intranet_client_passwords`, `docs/sql/2026-10-19-claves-clientes.sql`) al crear o
  cambiar la contraseña. Las cuentas anteriores no la tienen: se genera una nueva.
- Puesto (`intranet_profiles.job_title`, `docs/sql/2026-09-26-perfil-puesto.sql`):
  texto libre que define el admin en `/admin` (Diseñador/a, Project manager…), **solo
  para mostrar**; los permisos siguen siendo `role` + `areas`. `getTeam()` lo expone
  como `jobTitle` y selecciona `*` para no romper si la columna todavía no existe.
- Pestaña Equipo de cada cliente (`/clientes/[slug]/equipo` y `/mi-empresa/equipo`,
  misma `EquipoView`): los miembros activos de `intranet_client_assignments`, vía
  `getClientTeam()` con service_role (la cuenta del cliente no ve asignaciones ni
  perfiles por RLS).
- Cuenta de servicio de Google: `lib/google.ts` (token por usuario + scope) la
  comparten Calendar y Drive. La delegación en admin.google.com tiene que tener los
  dos scopes: `calendar.events.readonly` y `drive` (al editarla se reemplaza la lista).
  También da la foto de perfil cuando el login de Google no la trajo (a alejo@ no se
  la manda aunque la tenga): `lib/google-photo.ts` pide `drive/v3/about` como ese
  usuario, cacheado un día; lo usan `getSession()` y `getTeam()`.
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
  META, CRM) **no** llevan `loading.tsx` propio, porque `?mes=` lo reiniciaría y
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
- Comparación contra el período anterior (META y CRM): `previousPeriod()` de
  `lib/period.ts` da el período inmediatamente anterior del mismo largo, `compare()` de
  `lib/compare.ts` arma el cambio (cada métrica declara si mejorar es subir, bajar o
  ninguna: el gasto va sin color) y `Kpi` lo dibuja con `change` / `versus` en lugar de
  `sub`. Solo se compara si el período anterior está entero dentro de lo guardado
  (`getMetaFirstDate` en META; primera oportunidad y `CRM_HISTORY_DAYS` en CRM); si no,
  queda el texto de antes. En CRM se comparan Oportunidades, Ganadas, Total en tickets
  y Ticket promedio: las ventas se cuentan por fecha de venta (`won_at`, ver
  `.claude/rules/crm.md`). Falta llevarlo a WEB y Vista general.
- Selector de período (pedido del usuario): atajos = **los últimos tres meses
  calendario** (en octubre: Agosto, Septiembre, Octubre; `monthShortcuts()`), más
  Personalizado. URL `?mes=YYYY-MM`; sin nada, el mes actual; `?dias=N` se sigue
  leyendo solo por links viejos. Un mes se compara con el anterior entero, o el actual
  (en curso) con los mismos días del anterior (`previousPeriod`). Por eso el CRM trae
  95 días (`LEAD_DAYS`, `CRM_HISTORY_DAYS`): el primer mes puede arrancar 92 días atrás.
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
