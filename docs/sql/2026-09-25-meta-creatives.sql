-- Creativo de cada anuncio de Meta: tipo (video / imagen) y miniatura, para la
-- tabla de la vista de META y la card de mejores videos del CRM.
--
-- Tabla aparte y no columnas en intranet_meta_ads: esa tabla tiene una fila por
-- anuncio y día, y el sync solo reescribe los últimos 7 días. La miniatura es una
-- URL firmada de Meta que vence a los pocos días, así que tiene que renovarse para
-- todos los anuncios, hayan tenido entrega reciente o no. Acá hay una fila por
-- anuncio y cada corrida del sync la pisa.
--
-- Correr en Supabase → SQL Editor (proyecto compartido; solo crea una tabla nueva
-- con el prefijo intranet_, no toca nada del otro proyecto). Hasta que se corra,
-- la app sigue funcionando y muestra el ícono genérico en vez de la miniatura.

create table if not exists public.intranet_meta_creatives (
  client_id      uuid not null references public.intranet_clients(id) on delete cascade,
  ad_external_id text not null,
  -- 'video' | 'image' | 'other'
  creative_type  text not null default 'other',
  thumbnail_url  text,
  updated_at     timestamptz not null default now(),
  primary key (client_id, ad_external_id)
);

alter table public.intranet_meta_creatives enable row level security;

-- Lectura: cualquier miembro activo, igual que el resto de las métricas de
-- cliente (cada página valida además su área). La escritura la hace el sync con
-- service_role, que saltea RLS.
drop policy if exists "intranet_meta_creatives_select" on public.intranet_meta_creatives;
create policy "intranet_meta_creatives_select"
  on public.intranet_meta_creatives for select
  using (exists (select 1 from public.intranet_profiles p where p.id = auth.uid() and p.active));

-- Refrescar el schema cache de PostgREST para que la API vea la tabla nueva.
notify pgrst, 'reload schema';
