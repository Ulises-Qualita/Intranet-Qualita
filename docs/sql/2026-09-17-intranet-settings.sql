-- Configuración global de la intranet (clave → JSON).
-- Primer uso: la fila 'notion' guarda qué data sources de Notion son Proyectos y
-- Tickets, y cómo se mapean sus propiedades a las tareas de la intranet.
--
-- No guarda secretos: el token de Notion vive en NOTION_TOKEN (env, solo server).
--
-- Correr en Supabase → SQL Editor (proyecto compartido; solo crea una tabla nueva
-- con el prefijo intranet_, no toca nada del otro proyecto).

create table if not exists public.intranet_settings (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.intranet_settings enable row level security;

-- Lectura: cualquier miembro activo del equipo (la config no es sensible y la
-- necesita cualquier vista que muestre tareas).
drop policy if exists "intranet_settings_select" on public.intranet_settings;
create policy "intranet_settings_select"
  on public.intranet_settings for select
  using (
    exists (
      select 1 from public.intranet_profiles p
      where p.id = auth.uid() and p.active
    )
  );

-- Escritura: solo admin. intranet_is_admin() es SECURITY DEFINER y evita la
-- recursión de RLS sobre intranet_profiles.
drop policy if exists "intranet_settings_write" on public.intranet_settings;
create policy "intranet_settings_write"
  on public.intranet_settings for all
  using (public.intranet_is_admin())
  with check (public.intranet_is_admin());

-- Refrescar el schema cache de PostgREST para que la API vea la tabla nueva.
notify pgrst, 'reload schema';
