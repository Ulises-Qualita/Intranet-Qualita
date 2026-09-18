-- Fijar un mensaje arriba de todo en el foro.
--
-- Pensado para el mensaje de bienvenida y para lo que el equipo tenga que ver sí o
-- sí: sin esto, el orden es estricto por fecha y cualquier cosa importante se va
-- hundiendo sola.
--
-- Solo un admin fija, igual que con el estado, y por el mismo motivo se vuelve a
-- exigir con el trigger: una política de RLS no ve el valor anterior de la fila,
-- así que no puede decir "solo el admin cambia esta columna".
--
-- Correr DESPUÉS de docs/sql/2026-09-18-foro.sql, en Supabase → SQL Editor.

alter table public.intranet_forum_posts
  add column if not exists pinned boolean not null default false;

-- Los fijados primero y, dentro de cada grupo, los más nuevos arriba.
create index if not exists intranet_forum_posts_orden_idx
  on public.intranet_forum_posts (pinned desc, created_at desc);

-- Reemplaza la versión anterior, que solo cuidaba el estado.
create or replace function public.intranet_forum_status_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.intranet_is_admin() then
    if new.status is distinct from old.status then
      raise exception 'Solo un administrador puede cambiar el estado de un mensaje del foro';
    end if;
    if new.pinned is distinct from old.pinned then
      raise exception 'Solo un administrador puede fijar un mensaje del foro';
    end if;
  end if;
  return new;
end;
$$;

-- Refrescar el schema cache de PostgREST para que la API vea la columna nueva.
notify pgrst, 'reload schema';
