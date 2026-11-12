-- Criterio de pauta (Administración → Criterio de pauta): textos y archivos que se
-- le suman a Claude en "Analizar plataforma" (lib/analysis/), separados por
-- plataforma. Lo que está activo de la plataforma analizada va en cada análisis.
--
-- 1. intranet_ad_criteria: un criterio por fila. kind = 'texto' (escrito en la
--    intranet, en content) o 'archivo' (en el bucket; de los Word y los archivos de
--    texto se guarda también el texto extraído en content, los PDF e imágenes se
--    mandan tal cual).
-- 2. Bucket privado intranet-ad-criteria, objeto = <platform>/<id>. La subida va con
--    URL firmada que arma el server con service_role y la lectura también la hace el
--    server, así que no hacen falta políticas de Storage.
--
-- RLS: lo leen el área admin (la solapa), el área META (corre los análisis) y los
-- admin; lo escriben solo los admin.
--
-- Correr en Supabase → SQL Editor, el archivo entero (proyecto compartido: solo
-- crea objetos con el prefijo intranet_ / intranet-).

create table if not exists public.intranet_ad_criteria (
  id          uuid primary key default gen_random_uuid(),
  platform    text not null check (platform in ('meta', 'google_ads')),
  kind        text not null check (kind in ('texto', 'archivo')),
  title       text not null,
  content     text,
  file_path   text,
  file_name   text,
  mime_type   text,
  size        int,
  active      boolean not null default true,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists intranet_ad_criteria_platform_idx
  on public.intranet_ad_criteria (platform, created_at);

alter table public.intranet_ad_criteria enable row level security;

drop policy if exists "intranet_ad_criteria_select" on public.intranet_ad_criteria;
create policy "intranet_ad_criteria_select"
  on public.intranet_ad_criteria for select
  using (
    exists (
      select 1 from public.intranet_profiles p
      where p.id = auth.uid() and p.active
        and (
          p.role = 'admin'
          or coalesce((p.areas ->> 'meta')::boolean, false)
          or coalesce((p.areas ->> 'admin')::boolean, false)
        )
    )
  );

drop policy if exists "intranet_ad_criteria_write" on public.intranet_ad_criteria;
create policy "intranet_ad_criteria_write"
  on public.intranet_ad_criteria for all
  using (public.intranet_is_admin())
  with check (public.intranet_is_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'intranet-ad-criteria',
  'intranet-ad-criteria',
  false,
  20971520,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown',
    'text/csv',
    'image/png',
    'image/jpeg',
    'image/webp'
  ]
)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
