-- Métricas de Google Ads por cliente (lib/google-ads-sync.ts).
--
-- Igual que Meta: el cron guarda los últimos 90 días y la solapa GADS lee de acá,
-- nunca de la API al abrir la vista. En cada corrida se reescriben los últimos
-- días, porque Google sigue atribuyendo conversiones a fechas pasadas.
--
-- 1. intranet_gads_daily: totales de la cuenta por día.
-- 2. intranet_gads_campaigns: cada campaña por día (la vista suma el período).
--
-- Los montos van en la moneda de la cuenta (cost_micros / 1e6), sin convertir.
-- El estado del sync (synced_at, sync_error) va en intranet_integration_secrets,
-- provider 'google_ads', como el resto de las integraciones.
--
-- Correr en Supabase → SQL Editor, el archivo entero (proyecto compartido: solo
-- crea objetos con el prefijo intranet_). Requiere 2026-10-07-google-ads-provider.sql.

create table if not exists public.intranet_gads_daily (
  client_id          uuid not null references public.intranet_clients(id) on delete cascade,
  date               date not null,
  impressions        bigint not null default 0,
  clicks             bigint not null default 0,
  cost               numeric(14, 2) not null default 0,
  -- Google las informa con decimales (atribución fraccionada).
  conversions        numeric(12, 2) not null default 0,
  conversions_value  numeric(14, 2) not null default 0,
  synced_at          timestamptz not null default now(),
  primary key (client_id, date)
);

create table if not exists public.intranet_gads_campaigns (
  client_id          uuid not null references public.intranet_clients(id) on delete cascade,
  campaign_id        text not null,
  date               date not null,
  name               text not null,
  -- ENABLED | PAUSED | REMOVED, y el tipo (SEARCH, PERFORMANCE_MAX, DISPLAY…), tal cual.
  status             text,
  channel            text,
  impressions        bigint not null default 0,
  clicks             bigint not null default 0,
  cost               numeric(14, 2) not null default 0,
  conversions        numeric(12, 2) not null default 0,
  conversions_value  numeric(14, 2) not null default 0,
  primary key (client_id, campaign_id, date)
);

create index if not exists intranet_gads_campaigns_client_date_idx
  on public.intranet_gads_campaigns (client_id, date desc);

alter table public.intranet_gads_daily enable row level security;
alter table public.intranet_gads_campaigns enable row level security;

-- Lectura: el equipo con el área META (la de la publicidad) o admin. La solapa es
-- solo del equipo: la cuenta del cliente no lee estas tablas. La escritura la
-- hace el sync con service_role.
drop policy if exists "intranet_gads_daily_team" on public.intranet_gads_daily;
create policy "intranet_gads_daily_team"
  on public.intranet_gads_daily for select
  using (
    exists (
      select 1 from public.intranet_profiles p
      where p.id = auth.uid() and p.active
        and (p.role = 'admin' or coalesce((p.areas ->> 'meta')::boolean, false))
    )
  );

drop policy if exists "intranet_gads_campaigns_team" on public.intranet_gads_campaigns;
create policy "intranet_gads_campaigns_team"
  on public.intranet_gads_campaigns for select
  using (
    exists (
      select 1 from public.intranet_profiles p
      where p.id = auth.uid() and p.active
        and (p.role = 'admin' or coalesce((p.areas ->> 'meta')::boolean, false))
    )
  );

notify pgrst, 'reload schema';
