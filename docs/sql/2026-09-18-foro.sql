-- Foro interno: el equipo reporta errores, propone mejoras y pregunta cosas de la
-- intranet, y cada entrada se puede seguir hasta cerrarla.
--
-- Todo el equipo activo lee todo: es un foro interno de un estudio chico, no hay
-- nada que ocultar entre compañeros. Escribir es otra cosa: cada uno edita y borra
-- lo suyo, y el admin puede borrar cualquier cosa (duplicados, algo mal cargado).
--
-- El ESTADO es lo único que solo mueve un admin, y eso no se puede expresar con
-- RLS: una política no ve el valor anterior de la fila, así que no puede decir
-- "solo el admin cambia esta columna". Va como trigger (ver más abajo).
--
-- Correr en Supabase → SQL Editor (proyecto compartido; solo crea tablas nuevas
-- con el prefijo intranet_, no toca nada del otro proyecto).

create table if not exists public.intranet_forum_posts (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid not null references auth.users(id) on delete cascade,
  kind        text not null default 'mejora' check (kind in ('mejora', 'error', 'pregunta')),
  title       text not null check (length(trim(title)) > 0),
  body        text not null default '',
  status      text not null default 'abierto' check (status in ('abierto', 'en_curso', 'resuelto', 'descartado')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists intranet_forum_posts_recientes_idx
  on public.intranet_forum_posts (created_at desc);

create table if not exists public.intranet_forum_comments (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.intranet_forum_posts(id) on delete cascade,
  author_id   uuid not null references auth.users(id) on delete cascade,
  body        text not null check (length(trim(body)) > 0),
  created_at  timestamptz not null default now()
);

create index if not exists intranet_forum_comments_post_idx
  on public.intranet_forum_comments (post_id, created_at);

alter table public.intranet_forum_posts enable row level security;
alter table public.intranet_forum_comments enable row level security;

-- Quién es "del equipo": cualquier perfil activo de la intranet.
create or replace function public.intranet_is_active()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (select 1 from public.intranet_profiles p where p.id = auth.uid() and p.active);
$$;

-- ---------- Entradas ----------

drop policy if exists "intranet_forum_posts_select" on public.intranet_forum_posts;
create policy "intranet_forum_posts_select"
  on public.intranet_forum_posts for select
  using (public.intranet_is_active());

-- Solo a nombre propio: nadie publica firmando como otro.
drop policy if exists "intranet_forum_posts_insert" on public.intranet_forum_posts;
create policy "intranet_forum_posts_insert"
  on public.intranet_forum_posts for insert
  with check (author_id = auth.uid() and public.intranet_is_active());

drop policy if exists "intranet_forum_posts_update" on public.intranet_forum_posts;
create policy "intranet_forum_posts_update"
  on public.intranet_forum_posts for update
  using (author_id = auth.uid() or public.intranet_is_admin())
  with check (author_id = auth.uid() or public.intranet_is_admin());

drop policy if exists "intranet_forum_posts_delete" on public.intranet_forum_posts;
create policy "intranet_forum_posts_delete"
  on public.intranet_forum_posts for delete
  using (author_id = auth.uid() or public.intranet_is_admin());

-- El estado es del admin. Sin esto, el autor de una entrada podría marcarla como
-- resuelta desde la API aunque la interfaz no se lo ofrezca.
create or replace function public.intranet_forum_status_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status and not public.intranet_is_admin() then
    raise exception 'Solo un administrador puede cambiar el estado de una entrada del foro';
  end if;
  return new;
end;
$$;

drop trigger if exists forum_status_guard_intranet on public.intranet_forum_posts;
create trigger forum_status_guard_intranet
  before update on public.intranet_forum_posts
  for each row execute function public.intranet_forum_status_guard();

-- ---------- Respuestas ----------

drop policy if exists "intranet_forum_comments_select" on public.intranet_forum_comments;
create policy "intranet_forum_comments_select"
  on public.intranet_forum_comments for select
  using (public.intranet_is_active());

drop policy if exists "intranet_forum_comments_insert" on public.intranet_forum_comments;
create policy "intranet_forum_comments_insert"
  on public.intranet_forum_comments for insert
  with check (author_id = auth.uid() and public.intranet_is_active());

drop policy if exists "intranet_forum_comments_update" on public.intranet_forum_comments;
create policy "intranet_forum_comments_update"
  on public.intranet_forum_comments for update
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

drop policy if exists "intranet_forum_comments_delete" on public.intranet_forum_comments;
create policy "intranet_forum_comments_delete"
  on public.intranet_forum_comments for delete
  using (author_id = auth.uid() or public.intranet_is_admin());

-- Refrescar el schema cache de PostgREST para que la API vea las tablas nuevas.
notify pgrst, 'reload schema';
