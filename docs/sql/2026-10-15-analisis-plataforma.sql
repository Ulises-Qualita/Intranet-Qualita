-- "Analizar plataforma" (solapas META y GADS, solo equipo): Claude revisa cómo está
-- configurada la cuenta publicitaria y deja recomendaciones accionables que los
-- paid media tildan como hechas o descartadas (lib/analysis/).
--
-- 1. intranet_platform_analyses: un análisis por corrida (cliente, plataforma,
--    período, lectura general y lo que funciona bien).
-- 2. intranet_platform_recommendations: cada recomendación del análisis, con su
--    estado (pendiente / hecha / descartada), quién lo cambió y cuándo.
--
-- RLS: el equipo con el área META (la de la publicidad, cubre Meta y Google Ads) o
-- admin; la cuenta del cliente no lo ve. Se escribe con la sesión del usuario.
--
-- Correr en Supabase → SQL Editor, el archivo entero (proyecto compartido: solo
-- crea objetos con el prefijo intranet_).

create table if not exists public.intranet_platform_analyses (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.intranet_clients(id) on delete cascade,
  platform    text not null check (platform in ('meta', 'google_ads')),
  since       date not null,
  until       date not null,
  -- Lectura general de la cuenta, en 3 a 5 oraciones.
  summary     text not null,
  -- Lo que está funcionando y conviene mantener: lista de textos.
  strengths   jsonb not null default '[]'::jsonb,
  model       text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists intranet_platform_analyses_client_idx
  on public.intranet_platform_analyses (client_id, platform, created_at desc);

create table if not exists public.intranet_platform_recommendations (
  id           uuid primary key default gen_random_uuid(),
  analysis_id  uuid not null references public.intranet_platform_analyses(id) on delete cascade,
  client_id    uuid not null references public.intranet_clients(id) on delete cascade,
  position     int not null,
  priority     text not null check (priority in ('alta', 'media', 'baja')),
  effort       text not null check (effort in ('bajo', 'medio', 'alto')),
  -- Presupuesto, segmentación, creatividades, estructura, puja, seguimiento…
  category     text not null,
  title        text not null,
  -- Dónde aplicarla: "Campaña · Nombre", "Conjunto · Nombre", "Cuenta".
  target       text not null,
  action       text not null,
  reason       text not null,
  impact       text not null,
  status       text not null default 'pendiente' check (status in ('pendiente', 'hecha', 'descartada')),
  status_by    uuid references auth.users(id) on delete set null,
  status_at    timestamptz
);

create index if not exists intranet_platform_recommendations_analysis_idx
  on public.intranet_platform_recommendations (analysis_id, position);

alter table public.intranet_platform_analyses enable row level security;
alter table public.intranet_platform_recommendations enable row level security;

drop policy if exists "intranet_platform_analyses_team" on public.intranet_platform_analyses;
create policy "intranet_platform_analyses_team"
  on public.intranet_platform_analyses for all
  using (
    exists (
      select 1 from public.intranet_profiles p
      where p.id = auth.uid() and p.active
        and (p.role = 'admin' or coalesce((p.areas ->> 'meta')::boolean, false))
    )
  )
  with check (
    exists (
      select 1 from public.intranet_profiles p
      where p.id = auth.uid() and p.active
        and (p.role = 'admin' or coalesce((p.areas ->> 'meta')::boolean, false))
    )
  );

drop policy if exists "intranet_platform_recommendations_team" on public.intranet_platform_recommendations;
create policy "intranet_platform_recommendations_team"
  on public.intranet_platform_recommendations for all
  using (
    exists (
      select 1 from public.intranet_profiles p
      where p.id = auth.uid() and p.active
        and (p.role = 'admin' or coalesce((p.areas ->> 'meta')::boolean, false))
    )
  )
  with check (
    exists (
      select 1 from public.intranet_profiles p
      where p.id = auth.uid() and p.active
        and (p.role = 'admin' or coalesce((p.areas ->> 'meta')::boolean, false))
    )
  );

notify pgrst, 'reload schema';
