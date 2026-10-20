-- Un miembro nuevo del equipo arranca con acceso a todas las áreas menos admin.
--
-- Antes el perfil se creaba sin áreas ('{}') y había que habilitarlas a mano en
-- /admin. Ahora el trigger le da las mismas que DEFAULT_MEMBER_AREAS
-- (lib/auth-shared.ts); si se suma un área nueva, actualizar los dos lados.
-- Los perfiles que ya existen no se tocan.
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
      '{"inicio": true, "equipo": true, "clientes": true, "meta": true, "crm": true, "tareas": true}'::jsonb,
      true
    )
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;
