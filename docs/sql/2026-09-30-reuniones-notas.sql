-- Descripción de las reuniones ya hechas (solapa Reuniones de cada cliente).
--
-- Las reuniones no se guardan: se leen en vivo de Google Calendar (lib/calendar.ts).
-- Acá va solo el texto que escribe el equipo para cada una, atado a la clave de la
-- reunión (Meeting.key = "<iCalUID>|<inicio>"), que es estable mientras el evento
-- no cambie de horario.
--
-- El equipo con el área Clientes (o admin) lee y escribe; la cuenta del cliente
-- solo lee las de su empresa.
--
-- Correr en Supabase → SQL Editor. Solo toca tablas con prefijo intranet_.

create table if not exists public.intranet_meeting_notes (
  client_id   uuid not null references public.intranet_clients(id) on delete cascade,
  meeting_key text not null,
  notes       text not null check (char_length(notes) between 1 and 4000),
  updated_by  uuid references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (client_id, meeting_key)
);

alter table public.intranet_meeting_notes enable row level security;

drop policy if exists "intranet_meeting_notes_team" on public.intranet_meeting_notes;
create policy "intranet_meeting_notes_team"
  on public.intranet_meeting_notes for all to authenticated
  using (
    exists (
      select 1 from public.intranet_profiles p
      where p.id = auth.uid() and p.active
        and (p.role = 'admin' or coalesce((p.areas ->> 'clientes')::boolean, false))
    )
  )
  with check (
    exists (
      select 1 from public.intranet_profiles p
      where p.id = auth.uid() and p.active
        and (p.role = 'admin' or coalesce((p.areas ->> 'clientes')::boolean, false))
    )
  );

-- intranet_my_client_id() viene de 2026-09-25-cuentas-clientes.sql.
drop policy if exists "intranet_meeting_notes_client_user" on public.intranet_meeting_notes;
create policy "intranet_meeting_notes_client_user"
  on public.intranet_meeting_notes for select to authenticated
  using (client_id = public.intranet_my_client_id());

notify pgrst, 'reload schema';
