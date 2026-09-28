-- Reportes por cliente (solapa Reportes del panel del equipo).
--
-- 1. intranet_leads.stage_changed_at: última vez que la oportunidad cambió de
--    etapa (en Odoo, date_last_stage_update). Sirve para el tiempo de respuesta
--    Nuevo → Contactado. Kommo no lo informa y queda en null.
-- 2. intranet_clarity_daily.sources: sesiones del día por origen del tráfico
--    (dimensión Source de Clarity). Se acumula desde que corre este cambio: la API
--    no da historial.
-- 3. intranet_client_reports: cada HTML generado, para volver a bajarlo.
--
-- Correr en Supabase → SQL Editor. Solo toca tablas con prefijo intranet_.

alter table public.intranet_leads
  add column if not exists stage_changed_at timestamptz;

alter table public.intranet_clarity_daily
  add column if not exists sources jsonb not null default '[]'::jsonb;

create table if not exists public.intranet_client_reports (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.intranet_clients(id) on delete cascade,
  since       date not null,
  until       date not null,
  -- El HTML completo, autónomo (con las miniaturas embebidas).
  html        text not null,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists intranet_client_reports_client_idx
  on public.intranet_client_reports (client_id, created_at desc);

alter table public.intranet_client_reports enable row level security;

-- Solo el equipo con el área Clientes (o admin). Las cuentas de clientes no
-- tienen perfil en intranet_profiles, así que quedan afuera.
drop policy if exists "intranet_client_reports_team" on public.intranet_client_reports;
create policy "intranet_client_reports_team"
  on public.intranet_client_reports for all
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

notify pgrst, 'reload schema';
