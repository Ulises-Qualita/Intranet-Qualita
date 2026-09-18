-- Historial del agente de Claude: una fila por conversación y una por mensaje.
--
-- Solo se guarda el TEXTO de cada turno, nunca los resultados de las tools. El
-- agente vuelve a consultar los datos en cada conversación, así que duplicar acá
-- leads del CRM o métricas de Meta sería guardar datos de clientes de más, con
-- una copia que además envejece mal.
--
-- Cada usuario ve únicamente sus propias conversaciones: ni siquiera un admin lee
-- las de otro (el agente responde según los permisos de quien pregunta, así que un
-- hilo ajeno puede contener áreas que el que mira no tiene habilitadas).
--
-- Correr en Supabase → SQL Editor (proyecto compartido; solo crea tablas nuevas
-- con el prefijo intranet_, no toca nada del otro proyecto).

create table if not exists public.intranet_agent_threads (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- Las primeras palabras de la pregunta inicial; se usa en la lista de hilos.
  title       text not null default 'Nueva consulta',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists intranet_agent_threads_user_idx
  on public.intranet_agent_threads (user_id, updated_at desc);

create table if not exists public.intranet_agent_messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references public.intranet_agent_threads(id) on delete cascade,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null,
  -- Qué tools consultó el agente en ese turno, para poder mostrarlo al retomar
  -- la conversación. Solo los nombres y sus argumentos, nunca las respuestas.
  tools       jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists intranet_agent_messages_thread_idx
  on public.intranet_agent_messages (thread_id, created_at);

alter table public.intranet_agent_threads enable row level security;
alter table public.intranet_agent_messages enable row level security;

-- Hilos: cada uno es dueño de los suyos y de ningún otro.
drop policy if exists "intranet_agent_threads_own" on public.intranet_agent_threads;
create policy "intranet_agent_threads_own"
  on public.intranet_agent_threads for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Mensajes: se llega a ellos por el hilo, que ya filtra por usuario.
drop policy if exists "intranet_agent_messages_own" on public.intranet_agent_messages;
create policy "intranet_agent_messages_own"
  on public.intranet_agent_messages for all
  using (
    exists (
      select 1 from public.intranet_agent_threads t
      where t.id = thread_id and t.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.intranet_agent_threads t
      where t.id = thread_id and t.user_id = auth.uid()
    )
  );

-- Refrescar el schema cache de PostgREST para que la API vea las tablas nuevas.
notify pgrst, 'reload schema';
