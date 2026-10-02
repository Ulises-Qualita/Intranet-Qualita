-- Actividad de los chats del CRM (Kommo): un registro por mensaje entrante o
-- saliente, SIN el texto. Kommo lo entrega en su API de eventos con el token de
-- siempre; el contenido de los mensajes necesita otro permiso ("External chat
-- history", del Chats API add-on) y no se guarda acá.
--
-- Con esto la solapa CRM arma el monitoreo de atención: tiempo de respuesta,
-- conversaciones esperando respuesta y volumen por responsable.
--
-- El sync (lib/crm-chat-sync.ts) trae lo nuevo en cada corrida y va completando
-- hacia atrás hasta 30 días; lo de más de 90 días se borra.
--
-- Correr en Supabase → SQL Editor (proyecto compartido; solo crea una tabla nueva
-- con el prefijo intranet_, no toca nada del otro proyecto).

create table if not exists public.intranet_crm_chat_events (
  client_id   uuid not null references public.intranet_clients(id) on delete cascade,
  -- Id del evento en Kommo: el sync vuelve a pedir una franja ya leída y no duplica.
  event_id    text not null,
  -- Conversación (talk) de Kommo a la que pertenece el mensaje.
  talk_id     bigint not null,
  -- Lead del chat (id del CRM) y, como estaban al sincronizar, su nombre y su
  -- responsable. null si el chat es de un contacto sin lead o de un lead que el
  -- sync de oportunidades ya no trae.
  lead_id     text,
  lead_name   text,
  owner       text,
  -- true = lo escribió el cliente; false = salió de la empresa.
  incoming    boolean not null,
  -- Usuario de Kommo que lo envió. null en los entrantes y en los salientes que
  -- no salieron de un usuario de Kommo (la app de WhatsApp del teléfono, un bot).
  user_name   text,
  -- Canal: waba, instagram_business…
  origin      text,
  at          timestamptz not null,
  primary key (client_id, event_id)
);

create index if not exists intranet_crm_chat_events_client_at_idx
  on public.intranet_crm_chat_events (client_id, at desc);

alter table public.intranet_crm_chat_events enable row level security;

-- Lectura: cualquier miembro activo del equipo, igual que el resto de las
-- métricas de cliente. La cuenta del cliente no tiene política: no lo ve. La
-- escritura la hace el sync con service_role, que saltea RLS.
drop policy if exists "intranet_crm_chat_events_select" on public.intranet_crm_chat_events;
create policy "intranet_crm_chat_events_select"
  on public.intranet_crm_chat_events for select
  using (exists (select 1 from public.intranet_profiles p where p.id = auth.uid() and p.active));

-- Refrescar el schema cache de PostgREST para que la API vea la tabla nueva.
notify pgrst, 'reload schema';
