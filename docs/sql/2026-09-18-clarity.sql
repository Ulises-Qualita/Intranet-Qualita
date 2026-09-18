-- Analítica web por cliente, desde Microsoft Clarity.
--
-- La API de Clarity solo devuelve los últimos 1 a 3 días y permite 10 llamadas por
-- proyecto por día, así que no se puede consultar al abrir la vista: el cron toma
-- una foto diaria y acá se acumula la serie. El historial anterior a la primera
-- sincronización no existe y no se puede recuperar.
--
-- Se guarda también la respuesta cruda (raw): la documentación de Clarity solo
-- detalla los campos de la métrica Traffic, así que si el mapeo de alguna otra
-- resulta equivocado se corrige sin haber perdido los datos.
--
-- Correr en Supabase → SQL Editor (proyecto compartido; solo crea tablas nuevas
-- con el prefijo intranet_, no toca nada del otro proyecto).

create table if not exists public.intranet_clarity_daily (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references public.intranet_clients(id) on delete cascade,
  -- Día de la foto. Cada fila es la ventana de 24 h que devolvió la API ese día.
  as_of              date not null,

  sessions           integer not null default 0,
  bot_sessions       integer not null default 0,
  distinct_users     integer not null default 0,
  pages_per_session  numeric(10, 2),
  scroll_depth       numeric(5, 2),
  -- Segundos por sesión, como los informa Clarity.
  total_time         numeric(10, 2),
  active_time        numeric(10, 2),

  -- Señales de fricción: lo que Clarity aporta y ninguna otra integración tiene.
  rage_clicks        integer not null default 0,
  dead_clicks        integer not null default 0,
  excessive_scroll   integer not null default 0,
  quickbacks         integer not null default 0,
  script_errors      integer not null default 0,
  error_clicks       integer not null default 0,

  -- Cortes por dispositivo, tal como vienen; son pocos y de forma fija.
  devices            jsonb not null default '[]'::jsonb,
  raw                jsonb,
  synced_at          timestamptz not null default now(),

  unique (client_id, as_of)
);

create index if not exists intranet_clarity_daily_client_idx
  on public.intranet_clarity_daily (client_id, as_of desc);

-- Páginas más vistas del día. Tabla aparte porque son varias filas por día.
create table if not exists public.intranet_clarity_pages (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.intranet_clients(id) on delete cascade,
  as_of       date not null,
  url         text not null,
  sessions    integer not null default 0,
  created_at  timestamptz not null default now(),
  unique (client_id, as_of, url)
);

create index if not exists intranet_clarity_pages_client_idx
  on public.intranet_clarity_pages (client_id, as_of desc);

alter table public.intranet_clarity_daily enable row level security;
alter table public.intranet_clarity_pages enable row level security;

-- Lectura: cualquier miembro activo, igual que el resto de las métricas de
-- cliente. La escritura la hace el sync con service_role, que saltea RLS.
drop policy if exists "intranet_clarity_daily_select" on public.intranet_clarity_daily;
create policy "intranet_clarity_daily_select"
  on public.intranet_clarity_daily for select
  using (exists (select 1 from public.intranet_profiles p where p.id = auth.uid() and p.active));

drop policy if exists "intranet_clarity_pages_select" on public.intranet_clarity_pages;
create policy "intranet_clarity_pages_select"
  on public.intranet_clarity_pages for select
  using (exists (select 1 from public.intranet_profiles p where p.id = auth.uid() and p.active));

-- Refrescar el schema cache de PostgREST para que la API vea las tablas nuevas.
notify pgrst, 'reload schema';
