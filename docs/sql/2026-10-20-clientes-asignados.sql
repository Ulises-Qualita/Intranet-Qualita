-- Cada miembro del equipo ve solo los clientes que tiene asignados
-- (intranet_client_assignments). Un admin sigue viendo todos, y la cuenta de un
-- cliente, solo su empresa.
--
-- Diseño:
-- - Políticas RESTRICTIVE: se suman con AND a las que ya existen (que se combinan
--   con OR entre sí). Así no hace falta conocer ni reescribir las políticas de
--   cada tabla: lo que hoy deja ver al área Clientes, Meta, CRM… sigue igual,
--   pero solo para los clientes asignados.
-- - intranet_can_see_client() es SECURITY DEFINER para no depender de la RLS de
--   intranet_client_assignments (que también queda restringida por esta regla).
-- - service_role (syncs, cron, Administración) no pasa por RLS: no cambia nada.
-- - Alta de clientes: el INSERT de intranet_clients no se restringe (el cliente
--   nuevo todavía no tiene asignados); addClient asigna a quien lo crea.
-- - Asignaciones: solo se pueden dar o sacar en clientes que uno ya ve, así un
--   miembro no puede asignarse a sí mismo a un cliente ajeno.
--
-- Correr en Supabase → SQL Editor, el archivo entero y sin nada seleccionado.
-- Proyecto compartido: solo toca objetos intranet_.

create or replace function public.intranet_can_see_client(target uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return public.intranet_is_admin()
    or target = public.intranet_my_client_id()
    or exists (
      select 1 from public.intranet_client_assignments a
      where a.client_id = target and a.user_id = auth.uid()
    );
end;
$$;

-- ---------- intranet_clients: leer, editar y borrar (no crear) ----------

drop policy if exists "intranet_clients_assigned_select" on public.intranet_clients;
create policy "intranet_clients_assigned_select"
  on public.intranet_clients as restrictive for select to authenticated
  using (public.intranet_can_see_client(id));

drop policy if exists "intranet_clients_assigned_update" on public.intranet_clients;
create policy "intranet_clients_assigned_update"
  on public.intranet_clients as restrictive for update to authenticated
  using (public.intranet_can_see_client(id))
  with check (public.intranet_can_see_client(id));

drop policy if exists "intranet_clients_assigned_delete" on public.intranet_clients;
create policy "intranet_clients_assigned_delete"
  on public.intranet_clients as restrictive for delete to authenticated
  using (public.intranet_can_see_client(id));

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
         using (public.intranet_can_see_client(client_id))
         with check (public.intranet_can_see_client(client_id))',
      t || '_assigned', t
    );
  end loop;
end;
$$;

notify pgrst, 'reload schema';
