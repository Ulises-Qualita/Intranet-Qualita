-- Historial de etapas del CRM (Kommo): un registro por cada vez que un lead
-- cambió de etapa, de la API de eventos de Kommo (lead_status_changed), con el
-- token de siempre.
--
-- Con esto se sabe en qué etapa estaba un lead en cada momento: el agente mide
-- el tiempo de respuesta del chat por etapa, o antes y después de una etapa
-- (p. ej. la segunda reunión). intranet_leads solo guarda la etapa actual.
--
-- El sync (lib/crm-stage-sync.ts) trae lo nuevo en cada corrida y completa
-- hacia atrás hasta 95 días; lo de más de 180 días se borra.
--
-- Correr en Supabase → SQL Editor (proyecto compartido; solo crea una tabla nueva
-- con el prefijo intranet_, no toca nada del otro proyecto).

create table if not exists public.intranet_crm_stage_events (
  client_id   uuid not null references public.intranet_clients(id) on delete cascade,
  -- Id del evento en Kommo: el sync vuelve a pedir una franja ya leída y no duplica.
  event_id    text not null,
  -- Lead (id del CRM, igual que intranet_leads.external_id).
  lead_id     text not null,
  -- Nombre de la etapa de origen y de destino, como figuraban al sincronizar
  -- (mismo formato que intranet_leads.stage). null si la etapa ya no existe.
  from_stage  text,
  to_stage    text,
  at          timestamptz not null,
  primary key (client_id, event_id)
);

create index if not exists intranet_crm_stage_events_client_at_idx
  on public.intranet_crm_stage_events (client_id, at desc);

alter table public.intranet_crm_stage_events enable row level security;

-- Lectura: cualquier miembro activo del equipo, como los chats. La cuenta del
-- cliente no tiene política: no lo ve. La escritura la hace el sync con
-- service_role, que saltea RLS.
drop policy if exists "intranet_crm_stage_events_select" on public.intranet_crm_stage_events;
create policy "intranet_crm_stage_events_select"
  on public.intranet_crm_stage_events for select
  using (exists (select 1 from public.intranet_profiles p where p.id = auth.uid() and p.active));

-- Solo los clientes asignados (docs/sql/2026-10-20-clientes-asignados.sql).
drop policy if exists "intranet_crm_stage_events_assigned" on public.intranet_crm_stage_events;
create policy "intranet_crm_stage_events_assigned"
  on public.intranet_crm_stage_events as restrictive for all to authenticated
  using (client_id = any((select public.intranet_visible_client_ids())::uuid[]))
  with check (client_id = any((select public.intranet_visible_client_ids())::uuid[]));

-- Refrescar el schema cache de PostgREST para que la API vea la tabla nueva.
notify pgrst, 'reload schema';
