-- Manual de marca (solapa "Manual de marca" de cada cliente): el brandbook en PDF,
-- lo que Claude extrae de él (colores, tipografías, logo, tono) y los recursos que
-- se suben a mano (logos, fuentes, otros archivos) para descargar.
--
-- 1. intranet_brand_books: uno por cliente. pdf_* = el PDF en el bucket; data =
--    lo extraído y corregido a mano (jsonb, lib/brand-shared.ts → BrandData);
--    status = sin_extraer / extrayendo / listo / error.
-- 2. intranet_brand_assets: recursos sueltos (kind logo / fuente / otro).
-- 3. Bucket privado intranet-brand (hasta 115 MB por archivo; el límite global del
--    proyecto, Settings → Storage, tiene que ser igual o mayor), objetos <client_id>/<archivo>. Las subidas van
--    con URL firmada que arma el server con service_role y las descargas también
--    se firman en el server, así que no hacen falta políticas de Storage.
--
-- RLS: lee el equipo con el área Clientes (o admin) y la cuenta del cliente su
-- propia empresa (la solapa arranca apagada para el cliente: lo controla la
-- página, ver lib/client-tabs.ts → CLIENT_DEFAULT_OFF). Escribe solo el equipo.
-- Encima va la política restrictiva de clientes asignados.
--
-- Correr en Supabase → SQL Editor, el archivo entero (proyecto compartido: solo
-- crea objetos con el prefijo intranet_ / intranet-).

create table if not exists public.intranet_brand_books (
  client_id     uuid primary key references public.intranet_clients(id) on delete cascade,
  pdf_path      text,
  pdf_name      text,
  pdf_size      bigint,
  data          jsonb,
  status        text not null default 'sin_extraer'
                check (status in ('sin_extraer', 'extrayendo', 'listo', 'error')),
  error         text,
  extracted_at  timestamptz,
  updated_by    uuid references auth.users(id) on delete set null,
  updated_at    timestamptz not null default now()
);

create table if not exists public.intranet_brand_assets (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.intranet_clients(id) on delete cascade,
  kind        text not null check (kind in ('logo', 'fuente', 'otro')),
  name        text not null,
  file_path   text not null,
  file_name   text not null,
  mime_type   text,
  size        bigint,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists intranet_brand_assets_client_idx
  on public.intranet_brand_assets (client_id, kind, created_at);

alter table public.intranet_brand_books enable row level security;
alter table public.intranet_brand_assets enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['intranet_brand_books', 'intranet_brand_assets'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (
         client_id = public.intranet_my_client_id()
         or exists (
           select 1 from public.intranet_profiles p
           where p.id = auth.uid() and p.active
             and (p.role = ''admin'' or coalesce((p.areas ->> ''clientes'')::boolean, false))
         )
       )',
      t || '_read', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_team_write', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (
         exists (
           select 1 from public.intranet_profiles p
           where p.id = auth.uid() and p.active
             and (p.role = ''admin'' or coalesce((p.areas ->> ''clientes'')::boolean, false))
         )
       ) with check (
         exists (
           select 1 from public.intranet_profiles p
           where p.id = auth.uid() and p.active
             and (p.role = ''admin'' or coalesce((p.areas ->> ''clientes'')::boolean, false))
         )
       )',
      t || '_team_write', t
    );

    -- Clientes asignados (docs/sql/2026-10-20-clientes-asignados.sql).
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

insert into storage.buckets (id, name, public, file_size_limit)
values ('intranet-brand', 'intranet-brand', false, 120586240)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

-- Consumo de IA: la extracción del manual se registra como "marca" (USAGE_KINDS en
-- lib/agent/usage.ts).
alter table public.intranet_agent_usage
  drop constraint if exists intranet_agent_usage_kind_check;
alter table public.intranet_agent_usage
  add constraint intranet_agent_usage_kind_check check (kind in ('agente', 'reporte', 'analisis', 'marca'));

notify pgrst, 'reload schema';
