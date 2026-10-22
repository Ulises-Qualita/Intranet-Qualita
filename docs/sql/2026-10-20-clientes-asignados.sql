-- Cada miembro del equipo ve solo los clientes que tiene asignados
-- (intranet_client_assignments). Un admin sigue viendo todos, y la cuenta de un
-- cliente, solo su empresa.
--
-- Diseño:
-- - Políticas RESTRICTIVE: se suman con AND a las que ya existen (que se combinan
--   con OR entre sí). Así no hace falta conocer ni reescribir las políticas de
--   cada tabla: lo que hoy deja ver al área Clientes, Meta, CRM… sigue igual,
--   pero solo para los clientes asignados.
-- - intranet_visible_client_ids() es SECURITY DEFINER para no depender de la RLS
--   de intranet_client_assignments (que también queda restringida por esta regla).
-- - Rendimiento: las políticas usan `client_id = any((select ...)::uuid[])`. El
--   `(select ...)` hace que Postgres calcule la lista UNA vez por consulta, y el
--   `= any` aprovecha el índice de client_id. La primera versión llamaba a
--   intranet_can_see_client(client_id) en cada fila (con una subconsulta adentro)
--   y la solapa CRM de Arteplac, con miles de mensajes de chat, cortaba por
--   timeout (57014).
-- - service_role (syncs, cron, Administración) no pasa por RLS: no cambia nada.
-- - Alta de clientes: el INSERT de intranet_clients no se restringe (el cliente
--   nuevo todavía no tiene asignados); addClient asigna a quien lo crea.
-- - Asignaciones: solo se pueden dar o sacar en clientes que uno ya ve, así un
--   miembro no puede asignarse a sí mismo a un cliente ajeno.
--
-- Correr en Supabase → SQL Editor, el archivo entero y sin nada seleccionado.
-- Se puede volver a correr: reemplaza las funciones y las políticas.
-- Proyecto compartido: solo toca objetos intranet_.

-- Los clientes que ve el usuario: todos si es admin; si no, su empresa (cuenta
-- de cliente) y los que tiene asignados.
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
        ) || public.intranet_my_client_id(),
        null
      )
  end;
$$;

-- Para chequear un cliente puntual (fuera de las políticas).
create or replace function public.intranet_can_see_client(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target = any(public.intranet_visible_client_ids());
$$;

-- ---------- intranet_clients: leer, editar y borrar (no crear) ----------

drop policy if exists "intranet_clients_assigned_select" on public.intranet_clients;
create policy "intranet_clients_assigned_select"
  on public.intranet_clients as restrictive for select to authenticated
  using (id = any((select public.intranet_visible_client_ids())::uuid[]));

drop policy if exists "intranet_clients_assigned_update" on public.intranet_clients;
create policy "intranet_clients_assigned_update"
  on public.intranet_clients as restrictive for update to authenticated
  using (id = any((select public.intranet_visible_client_ids())::uuid[]))
  with check (id = any((select public.intranet_visible_client_ids())::uuid[]));

drop policy if exists "intranet_clients_assigned_delete" on public.intranet_clients;
create policy "intranet_clients_assigned_delete"
  on public.intranet_clients as restrictive for delete to authenticated
  using (id = any((select public.intranet_visible_client_ids())::uuid[]));

-- ---------- Tablas que cuelgan de un cliente (client_id) ----------
-- Se saltean las que todavía no existen (migraciones sin correr).

do $$
declare
  t text;
begin
  foreach t in array array[
    'intranet_client_integrations',
    'intranet_client_assignments',
    'intranet_client_users',
    'intranet_integration_secrets',
    'intranet_tasks',
    'intranet_meta_daily',
    'intranet_meta_ads',
    'intranet_meta_creatives',
    'intranet_crm_snapshot',
    'intranet_leads',
    'intranet_crm_sales',
    'intranet_crm_chat_events',
    'intranet_crm_stage_events',
    'intranet_clarity_daily',
    'intranet_clarity_pages',
    'intranet_gads_daily',
    'intranet_gads_campaigns',
    'intranet_client_reports',
    'intranet_meeting_notes',
    'intranet_client_milestones',
    'intranet_platform_analyses',
    'intranet_platform_recommendations'
  ] loop
    if to_regclass('public.' || t) is null then
      raise notice 'No existe %, se saltea', t;
      continue;
    end if;
    execute format('drop policy if exists %I on public.%I', t || '_assigned', t);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated
         using (client_id = any((select public.intranet_visible_client_ids())::uuid[]))
         with check (client_id = any((select public.intranet_visible_client_ids())::uuid[]))',
      t || '_assigned', t
    );
  end loop;
end;
$$;

notify pgrst, 'reload schema';
