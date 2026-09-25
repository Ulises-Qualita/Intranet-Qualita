-- Cuentas de clientes: una por empresa, con mail y contraseña, que entra a
-- /mi-empresa y ve solo los datos de su empresa, en modo lectura.
--
-- Diseño:
-- - Las cuentas de clientes NO tienen fila en intranet_profiles. Así quedan fuera
--   de todas las políticas que dejan leer a "cualquier perfil activo" (Clarity,
--   foro, creativos, presencia, settings) y de intranet_is_admin/has_area. El
--   alta desde /admin borra el perfil que crea on_auth_user_created_intranet.
-- - Esta tabla dice de qué empresa es cada cuenta, e intranet_my_client_id()
--   (SECURITY DEFINER, para no depender de la RLS de la propia tabla) la usa en
--   políticas nuevas de solo lectura, una por tabla que muestra /mi-empresa.
-- - Las políticas se suman con OR a las existentes: no le sacan nada al equipo,
--   y a una cuenta de cliente solo le abren las filas de su empresa.
--
-- Correr en Supabase → SQL Editor, el archivo entero y sin nada seleccionado (con
-- texto seleccionado, "Run" ejecuta solo esa parte). Proyecto compartido: solo
-- crea objetos con el prefijo intranet_ y políticas sobre tablas intranet_.

create table if not exists public.intranet_client_users (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  -- unique: una cuenta por empresa.
  client_id  uuid not null unique references public.intranet_clients(id) on delete cascade,
  email      text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.intranet_client_users enable row level security;

-- La cuenta ve su propia fila (para saber de qué empresa es) y un admin, todas.
-- Altas, bajas y cambios van por /admin con service_role.
drop policy if exists "intranet_client_users_select" on public.intranet_client_users;
create policy "intranet_client_users_select"
  on public.intranet_client_users for select
  using (user_id = auth.uid() or public.intranet_is_admin());

-- Empresa de la cuenta con la que se está consultando, o null si no es una
-- cuenta de cliente activa.
-- plpgsql y no sql: Postgres no valida el cuerpo contra las tablas al crearla,
-- así que no depende del orden en que se ejecute el script.
create or replace function public.intranet_my_client_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return (select client_id from public.intranet_client_users where user_id = auth.uid() and active);
end;
$$;

-- ---------- Lectura de su empresa, tabla por tabla ----------

drop policy if exists "intranet_clients_client_user" on public.intranet_clients;
create policy "intranet_clients_client_user"
  on public.intranet_clients for select to authenticated
  using (id = public.intranet_my_client_id());

drop policy if exists "intranet_client_integrations_client_user" on public.intranet_client_integrations;
create policy "intranet_client_integrations_client_user"
  on public.intranet_client_integrations for select to authenticated
  using (client_id = public.intranet_my_client_id());

drop policy if exists "intranet_meta_daily_client_user" on public.intranet_meta_daily;
create policy "intranet_meta_daily_client_user"
  on public.intranet_meta_daily for select to authenticated
  using (client_id = public.intranet_my_client_id());

drop policy if exists "intranet_meta_ads_client_user" on public.intranet_meta_ads;
create policy "intranet_meta_ads_client_user"
  on public.intranet_meta_ads for select to authenticated
  using (client_id = public.intranet_my_client_id());

drop policy if exists "intranet_meta_creatives_client_user" on public.intranet_meta_creatives;
create policy "intranet_meta_creatives_client_user"
  on public.intranet_meta_creatives for select to authenticated
  using (client_id = public.intranet_my_client_id());

drop policy if exists "intranet_crm_snapshot_client_user" on public.intranet_crm_snapshot;
create policy "intranet_crm_snapshot_client_user"
  on public.intranet_crm_snapshot for select to authenticated
  using (client_id = public.intranet_my_client_id());

drop policy if exists "intranet_leads_client_user" on public.intranet_leads;
create policy "intranet_leads_client_user"
  on public.intranet_leads for select to authenticated
  using (client_id = public.intranet_my_client_id());

drop policy if exists "intranet_clarity_daily_client_user" on public.intranet_clarity_daily;
create policy "intranet_clarity_daily_client_user"
  on public.intranet_clarity_daily for select to authenticated
  using (client_id = public.intranet_my_client_id());

drop policy if exists "intranet_clarity_pages_client_user" on public.intranet_clarity_pages;
create policy "intranet_clarity_pages_client_user"
  on public.intranet_clarity_pages for select to authenticated
  using (client_id = public.intranet_my_client_id());

-- El portal necesita la configuración de Notion (qué propiedad guarda el link):
-- solo esa fila, que no tiene secretos (el token de Notion está en el env).
drop policy if exists "intranet_settings_notion_client_user" on public.intranet_settings;
create policy "intranet_settings_notion_client_user"
  on public.intranet_settings for select to authenticated
  using (key = 'notion' and public.intranet_my_client_id() is not null);

notify pgrst, 'reload schema';
