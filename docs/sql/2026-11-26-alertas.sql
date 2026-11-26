-- Alertas por Telegram (Administración → Alertas, lib/alerts/).
--
-- - intranet_telegram_links: el chat de Telegram de cada persona del equipo. Se
--   vincula con un link al bot (t.me/<bot>?start=<code>): la persona toca
--   "Iniciar" y la intranet lee el /start con getUpdates.
-- - intranet_alerts: estado de cada alerta (una fila por cosa vigilada: una
--   integración, una cuenta, un anuncio…). Sirve para avisar una sola vez cuando
--   algo se rompe (o una vez por día, según el tipo) y avisar cuando se arregla.
--
-- Las dos tablas se leen y escriben solo desde el server con service_role,
-- después de validar el acceso: RLS activada y sin políticas.
--
-- Quién recibe cada tipo de alerta va en intranet_settings, fila "alerts".
--
-- Correr en Supabase → SQL Editor (proyecto compartido; solo crea tablas nuevas
-- con el prefijo intranet_).

create table if not exists public.intranet_telegram_links (
  profile_id  uuid primary key references public.intranet_profiles(id) on delete cascade,
  -- Código del link de vinculación; se borra al vincular.
  code        text,
  code_at     timestamptz,
  chat_id     bigint,
  username    text,
  linked_at   timestamptz
);

alter table public.intranet_telegram_links enable row level security;

create table if not exists public.intranet_alerts (
  id            uuid primary key default gen_random_uuid(),
  -- Qué se vigila, p. ej. "integration:<cliente>:meta" o "creative:<cliente>:<anuncio>".
  key           text not null unique,
  type          text not null,
  client_id     uuid references public.intranet_clients(id) on delete cascade,
  active        boolean not null default true,
  -- Último texto enviado (para el historial de Administración).
  title         text,
  message       text,
  first_at      timestamptz not null default now(),
  last_sent_at  timestamptz,
  resolved_at   timestamptz
);

create index if not exists intranet_alerts_recent_idx on public.intranet_alerts (last_sent_at desc);

alter table public.intranet_alerts enable row level security;

notify pgrst, 'reload schema';
