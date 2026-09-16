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
