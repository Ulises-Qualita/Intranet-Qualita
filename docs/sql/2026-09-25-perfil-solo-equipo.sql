-- El perfil de intranet (intranet_profiles) se crea solo para cuentas del equipo.
--
-- on_auth_user_created_intranet le creaba un perfil activo a TODO usuario nuevo de
-- Auth. Con el login por mail habilitado (cuentas de clientes), cualquiera puede
-- registrarse con la anon key, y ese perfil activo le abriría las políticas de
-- "cualquier perfil activo" (Clarity, foro, creativos de Meta, presencia). Ahora
-- el trigger ignora los mails que no son @qualita.studio: las cuentas de clientes
-- no tienen perfil (su acceso va por intranet_client_users) y un registro suelto
-- queda sin acceso a nada.
--
-- Mismo comportamiento de antes para el equipo: rol member, sin áreas, activo.
-- El alta desde /admin (addMember) sigue haciendo su propio upsert.
--
-- Correr en Supabase → SQL Editor. Solo reemplaza la función propia de la
-- intranet (sufijo _intranet); el trigger existente la sigue llamando.

create or replace function public.handle_new_user_intranet()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(coalesce(new.email, '')) like '%@qualita.studio' then
    insert into public.intranet_profiles (id, email, full_name, role, areas, active)
    values (
      new.id,
      new.email,
      coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
      'member',
      '{}'::jsonb,
      true
    )
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;

-- Perfiles que ya existan de cuentas que no son del equipo (por ejemplo, usuarios
-- del otro app que entraron con otro mail): se desactivan, no se borran, para
-- poder revisarlos. Descomentar después de mirar la consulta de abajo.
--
-- select id, email, active from public.intranet_profiles
--   where lower(coalesce(email, '')) not like '%@qualita.studio';
--
-- update public.intranet_profiles set active = false
--   where lower(coalesce(email, '')) not like '%@qualita.studio';
