<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md — Qualita Intranet
 
Guía del proyecto para desarrolladores y agentes de IA. Documenta stack, base de
datos (incluido lo que se comparte con otro proyecto), lógica del sistema, sistema
de diseño y roadmap. Mantener este archivo actualizado cuando algo cambie.
 
---
 
## 1. Qué es
 
Intranet interna del equipo de **Qualita Studio** (agencia de branding, diseño y
performance). No es un producto para vender: es una herramienta de uso interno.
 
Objetivo principal: un **dashboard por cliente** que centralice
- métricas de publicidad de la **API de Meta** (Instagram + Facebook Ads),
- estado de ventas del **CRM** (pipeline, etapas, leads, conversaciones),
- **tareas** pendientes por cliente,
más un panel interno del estudio (equipo, configuración) y un panel de
**administración** donde el admin da y quita acceso a cada área por usuario.
 
---
 
## 2. Stack
 
- **Framework:** Next.js (App Router) + React.
- **Auth + DB:** Supabase (Postgres + Auth). Login **solo con Google**.
- **Hosting previsto:** Vercel.
- **IA (roadmap):** API de Anthropic (Claude) para un agente de chat interno.
### Variables de entorno
 
```
NEXT_PUBLIC_SUPABASE_URL=...        # Project URL (pública)
NEXT_PUBLIC_SUPABASE_ANON_KEY=...   # anon key (pública, va en el front)
# Solo en el server, NUNCA en el cliente:
SUPABASE_SERVICE_ROLE_KEY=...       # usar solo en API routes/acciones de server
ANTHROPIC_API_KEY=...               # roadmap, solo server
```
 
Regla dura: la `service_role key` y la `ANTHROPIC_API_KEY` **nunca** llegan al
navegador. Solo se usan en Route Handlers / Server Actions.
 
---
 
## 3. Base de datos (Supabase)
 
### 3.1. Proyecto COMPARTIDO — leer con atención
 
La intranet **no** usa un proyecto Supabase propio: comparte un proyecto existente
con **otro app interno** del equipo. Ambos son plataformas internas y ambos usan el
mismo login de Google restringido a `@qualita.studio`, así que compartir el pool de
usuarios es intencional y está bien.
 
**Qué se comparte:**
- `auth.users` (mismos usuarios en los dos apps).
- La configuración de Auth (proveedor Google, restricción de dominio).
**Tablas del OTRO proyecto — NO tocar:**
`analysis_costs`, `app_settings`, `companies`, `diagnostics`, `share_tokens`.
 
**Convención para evitar colisiones:** todas las tablas de la intranet llevan el
prefijo **`intranet_`**. Nunca crear una tabla sin ese prefijo en `public`.
 
**Triggers propios:** usar sufijo `_intranet` para poder coexistir con triggers que
el otro proyecto ya tenga sobre `auth.users` (p. ej. `on_auth_user_created_intranet`).
 
### 3.2. Tablas de la intranet
 
#### `intranet_profiles` (implementada)
 
Una fila por usuario del equipo. Guarda el **rol** y los **accesos por área**
dentro de la intranet. Es independiente del otro proyecto: un mismo usuario puede
ser simple usuario allá y admin acá.
 
| Columna     | Tipo        | Notas                                                        |
|-------------|-------------|--------------------------------------------------------------|
| `id`        | uuid PK     | FK a `auth.users(id)`, `on delete cascade`                   |
| `email`     | text        |                                                              |
| `full_name` | text        |                                                              |
| `role`      | text        | `'admin'` \| `'member'` (default `member`)                   |
| `areas`     | jsonb       | acceso por área (ver claves abajo)                           |
| `active`    | boolean     | default `true`                                               |
| `created_at`| timestamptz | default `now()`                                              |
| `updated_at`| timestamptz | default `now()`                                              |
 
Claves de `areas` (todas boolean):
`inicio`, `equipo`, `config`, `clientes`, `meta`, `crm`, `tareas`, `admin`.
 
**RLS (activada):**
- SELECT: `id = auth.uid()` o admin.
- INSERT / UPDATE / DELETE: solo admin.
- Helper `intranet_is_admin()` (SECURITY DEFINER) evita recursión de RLS.
**Alta de perfiles:**
- Trigger `on_auth_user_created_intranet` → `handle_new_user_intranet()` crea el
  perfil al registrarse un usuario nuevo (rol `member`, sin áreas).
- Se corrió un **backfill** para cargar a los usuarios que ya existían en el
  proyecto compartido.
**Restricción de dominio:** el candado `@qualita.studio` se deja al mecanismo que
ya tiene el proyecto compartido / al consent screen "Interno" de Google. El trigger
propio de dominio queda **comentado** en el SQL para no duplicar comportamiento.
 
Archivo fuente: `docs/supabase-intranet-shared.sql`.
 
#### Tablas a crear (roadmap)
 
Cuando pasemos de datos mock a reales, con prefijo `intranet_`:
- `intranet_clients` — clientes (nombre, dominio/web, rubro, activo).
- `intranet_client_integrations` — conexión por cliente y por servicio
  (`meta`, `crm`, `whatsapp`): estado, tokens/refs (los secretos, del lado server).
- `intranet_tasks` — tareas por cliente (título, estado, prioridad, responsable,
  vencimiento).
- Cache de métricas: `intranet_meta_ads`, `intranet_meta_metrics`,
  `intranet_crm_pipeline`, `intranet_leads` — para no pegarle a las APIs externas
  en cada carga.
Todas con RLS que respete `role` y `areas` del usuario.
 
---
 
## 4. Autenticación y control de acceso
 
- **Login:** únicamente Google OAuth (usar `@supabase/ssr` en Next.js). No hay
  email/password en producción.
- **Dominio:** solo cuentas `@qualita.studio` (garantizado por Google "Interno" +
  proyecto compartido).
- **Al iniciar sesión:** el perfil ya existe (trigger + backfill). Como red de
  seguridad, la app puede hacer un `upsert` del perfil propio en el primer acceso.
- **Autorización por área:**
  - `role = 'admin'` → ve y usa **todo**, sin importar `areas`.
  - `role = 'member'` → solo ve las áreas con `areas[clave] = true`.
- **Doble barrera:** el control de acceso se aplica **en el front** (mostrar/ocultar
  navegación y vistas) **y en el server** (RLS + validación en API routes). Nunca
  confiar solo en el front.
---
 
## 5. Lógica del sistema (mapa funcional)
 
La navegación tiene **dos zonas** (ver mockup en `docs/`).
 
### Zona "Qualita" (nivel estudio)
 
- **Inicio** — resumen del estudio. KPIs: *Clientes activos*, *En onboarding*,
  *Tareas pendientes*, *Miembros del equipo* (calculados en vivo). Tabla de
  clientes (columnas: Cliente · Tareas · Estado) que abre el panel de cada cliente.
  Panel de carga del equipo.
- **Equipo** — miembros, rol/área, carga de trabajo, clientes asignados.
- **Configuración** — **matriz de integraciones por cliente** (Meta / CRM /
  WhatsApp, con "Conectar" por celda; las integraciones se conectan **por cliente**,
  no globalmente) + preferencias del equipo.
- **Administración** (solo admin) — usuarios del equipo: rol (Admin/Miembro),
  estado (Activo/Invitado) y **chips por área** para dar/quitar acceso. Invitación
  por email (valida dominio `@qualita.studio`). Esta pantalla escribe en
  `intranet_profiles`.
### Zona "Clientes"
 
Lista de clientes; al seleccionar uno se despliegan sus sub-vistas:
 
- **Vista general** — KPIs mezcla (alcance Meta, seguidores, leads en CRM,
  conversaciones), gráfico de alcance/interacción y embudo de ventas.
- **META** — enfocada en **publicidad**: KPIs de *Gasto total*, *CPL*, *Leads
  generados*, *ROAS*, *Impresiones*, *CTR*, *CPM*, *Conversiones*; **tabla de
  anuncios individuales** (nombre, estado activo/pausado, gasto, leads, CPL, CTR,
  impresiones) y **gráfico de gasto diario** debajo.
- **CRM** — pipeline (valor), leads, conversión, conversaciones; embudo por etapas
  y lista de últimos leads.
- **Tareas** — tablero en 3 columnas: Pendientes / En curso / Completadas, con
  prioridad, responsable y vencimiento.
### Integraciones por cliente (estado de conexión)
 
Cada cliente tiene banderas de conexión: `meta`, `crm`, `whatsapp`.
- Si una integración **no** está conectada, la solapa correspondiente muestra un
  **estado vacío con botón "Conectar"** (Meta → cuenta de Meta; CRM → CRM).
- En **Vista general**, las tarjetas que dependen de una integración sin conectar
  aparecen bloqueadas con un enlace "Conectar".
- Un cliente sin Meta ni CRM figura como **"Onboarding"** en Inicio.
- Conectar dispara (en real) el OAuth del servicio para **esa cuenta puntual**.
---
 
## 6. Sistema de diseño
 
Basado en la propuesta de branding de Qualita. Ver el **mockup HTML de referencia
en `docs/qualita-intranet.html`**: contiene todos los componentes ya resueltos
(login, sidebar de dos niveles, KPIs, KPI destacado con degradado, tablas, embudo,
chips, estados de "Conectar", modo oscuro). Usarlo como fuente de verdad visual.
 
### Color
 
| Rol            | Hex        |
|----------------|------------|
| Magenta (marca)| `#B50CC5`  |
| Coral (marca)  | `#FE6F61`  |
| Navy (texto)   | `#252851`  |
| Blanco         | `#FFFFFF`  |
| Crema          | `#FFF4EC`  |
 
Degradado de marca: `linear-gradient(120deg, #B50CC5, #FE6F61)`. Se usa **con
moderación**: solo en el KPI destacado de cada vista y en estados activos de
navegación. El resto, superficies neutras con bordes finos.
 
### Tipografía
 
- **Lexend** — títulos, números, KPIs (reemplazó a Unbounded).
- **DM Sans** — cuerpo de texto, tablas, labels.
- (Dongle es la tipografía del logotipo, no se usa en UI.)
### Temas
 
- **Claro** por defecto (fondo lavanda muy suave, tarjetas blancas, texto navy).
- **Oscuro** vía toggle en la barra lateral (arriba del usuario).
- Implementado con **CSS variables** que se redefinen en modo oscuro. Los acentos
  magenta/coral se mantienen en ambos temas.
- Roadmap: recordar la preferencia de tema (perfil o localStorage).
### Componentes clave (referencia en el mockup)
 
- **Sidebar** de dos niveles (Qualita + Clientes con acordeón por cliente).
- **KPI card** y **KPI hero** (con degradado).
- **KPI locked** (área sin conectar) con enlace "Conectar".
- **Estado "Conectar"** (empty state) para Meta / CRM.
- **Embudo** (barras horizontales con degradado).
- **Tablas** de clientes y de anuncios.
- **Chips** de área (panel de administración).
- **Pantalla de login** con botón Google.
---
 
## 7. Estructura de carpetas sugerida (Next.js App Router)
 
```
/
├─ app/
│  ├─ (auth)/login/page.tsx        # pantalla de login (Google)
│  ├─ (app)/                       # layout protegido (requiere sesión)
│  │  ├─ page.tsx                  # Inicio (estudio)
│  │  ├─ equipo/…                  # Equipo
│  │  ├─ configuracion/…           # Configuración (integraciones por cliente)
│  │  ├─ admin/…                   # Administración (solo admin)
│  │  └─ clientes/[id]/            # cliente: general/meta/crm/tareas
│  └─ api/
│     ├─ integraciones/…           # OAuth Meta/CRM por cliente (server)
│     └─ agente/…                  # endpoint del agente Claude (roadmap)
├─ components/                     # UI (basada en el mockup)
├─ lib/
│  └─ supabase/                    # client.ts (browser) y server.ts (SSR)
├─ docs/
│  ├─ qualita-intranet.html        # mockup de diseño (fuente visual)
│  └─ supabase-intranet-shared.sql # esquema de la intranet
└─ AGENTS.md
```
 
---
 
## 8. Roadmap: agente de IA (Claude) en la intranet
 
Burbuja de chat flotante para que el equipo haga consultas sobre clientes
("¿cómo viene SVN este mes?", "¿qué tareas quedan de Arteplac?").
 
Arquitectura:
1. Burbuja (front) → llama a un **endpoint propio** (`app/api/agente`), nunca a
   Anthropic directo.
2. El endpoint tiene la `ANTHROPIC_API_KEY` (solo server), busca en Supabase los
   datos del/los cliente(s) relevantes y se los pasa a Claude con la pregunta.
3. **Respeta permisos:** filtra por `role` y `areas` del usuario antes de darle
   datos a Claude. Si el usuario no tiene acceso al CRM de un cliente, el agente no
   debe exponer esos datos.
Fases: (a) versión simple con contexto por prompt; (b) agente con *tools* (buscar
cliente, traer métricas Meta, listar tareas) donde Claude decide qué consultar.
 
Hacerlo **después** de tener login + datos reales fluyendo.
 
---
 
## 9. Convenciones y reglas
 
- Prefijo `intranet_` en toda tabla nueva; sufijo `_intranet` en triggers propios.
- No modificar tablas ni triggers del otro proyecto.
- RLS siempre activada en tablas de la intranet.
- Secretos (service_role, tokens de Meta/CRM, API key de Claude) solo del lado
  server.
- Control de acceso duplicado: front (UX) + server/RLS (seguridad).
- El diseño sigue el mockup de `docs/`; mantener Lexend + DM Sans y el uso
  medido del degradado.
---
 
## 10. Estado actual
 
- [x] Mockup completo del front (en `docs/qualita-intranet.html`).
- [x] Proyecto Supabase (compartido) con `intranet_profiles`, RLS, trigger de alta
      y backfill de usuarios existentes.
- [x] Usuario admin definido.
- [ ] Proyecto Next.js + conexión a Supabase (`@supabase/ssr`).
- [ ] Login con Google + gating por `role`/`areas`.
- [ ] Panel de administración escribiendo en `intranet_profiles`.
- [ ] Tablas de clientes/tareas + integración real Meta y CRM.
- [x] Agente de Claude (burbuja flotante, fase b: con *tools*).
 
