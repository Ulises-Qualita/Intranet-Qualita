-- Hitos de cada cliente (solapa Hitos): la línea de tiempo del proyecto que ve el
-- cliente. La carga el equipo a mano: inicio del proyecto, entregas, lanzamientos
-- y cualquier otro hito, cada uno con su fecha.
--
-- El equipo con el área Clientes (o admin) lee y escribe; la cuenta del cliente
-- solo lee los de su empresa.
--
-- Correr en Supabase → SQL Editor. Solo toca tablas con prefijo intranet_.

create table if not exists public.intranet_client_milestones (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.intranet_clients(id) on delete cascade,
  -- inicio | hito | entrega | lanzamiento (lib/milestones-shared.ts).
  kind        text not null default 'hito' check (kind in ('inicio', 'hito', 'entrega', 'lanzamiento')),
  title       text not null check (char_length(title) between 1 and 120),
  description text check (char_length(description) <= 1000),
  date        date not null,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists intranet_client_milestones_client_date_idx
  on public.intranet_client_milestones (client_id, date);

alter table public.intranet_client_milestones enable row level security;

drop policy if exists "intranet_client_milestones_team" on public.intranet_client_milestones;
create policy "intranet_client_milestones_team"
  on public.intranet_client_milestones for all to authenticated
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
drop policy if exists "intranet_client_milestones_client_user" on public.intranet_client_milestones;
create policy "intranet_client_milestones_client_user"
  on public.intranet_client_milestones for select to authenticated
  using (client_id = public.intranet_my_client_id());

notify pgrst, 'reload schema';
