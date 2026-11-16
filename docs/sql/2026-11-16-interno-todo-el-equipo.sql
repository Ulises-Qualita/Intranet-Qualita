-- Panel interno de Qualita (intranet_clients.internal): lo ve TODO el equipo,
-- no solo los admins y los asignados. Las cuentas de clientes (/mi-empresa)
-- siguen viendo solo su empresa.
--
-- Reemplaza intranet_visible_client_ids() (docs/sql/2026-10-20-clientes-asignados.sql):
-- a un miembro del equipo (perfil activo en intranet_profiles; solo existe para
-- cuentas @qualita.studio) se le suma el cliente interno. Como todas las políticas
-- restrictivas usan esta función, alcanza con cambiarla: intranet_clients y cada
-- tabla con client_id lo dejan ver igual que a un cliente asignado.
--
-- Requiere docs/sql/2026-11-13-cliente-interno.sql (la columna internal).
-- Correr en Supabase → SQL Editor, el archivo entero. Se puede volver a correr.
-- Proyecto compartido: solo toca objetos intranet_.

create or replace function public.intranet_visible_client_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.intranet_is_admin() then
      coalesce((select array_agg(c.id) from public.intranet_clients c), '{}')
    else
      array_remove(
        array(
          select a.client_id from public.intranet_client_assignments a
          where a.user_id = auth.uid()
        )
        || array(
          select c.id from public.intranet_clients c
          where c.internal
            and exists (
              select 1 from public.intranet_profiles p
              where p.id = auth.uid() and p.active
            )
        )
        || public.intranet_my_client_id(),
        null
      )
  end;
$$;
