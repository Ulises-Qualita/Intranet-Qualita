-- Portal del cliente armado en la intranet (antes era una página de Notion).
--
-- 1. intranet_clients.portal: lo que el equipo carga a mano en el portal.
--    {"validator": {"name": "...", "role": "...", "phone": "..."}, "banner": 1759680000000}
--    banner = cuándo se subió el banner (sirve de versión para el cache del
--    navegador); sin banner, la clave no está. Hereda la RLS de intranet_clients:
--    el equipo la edita y la cuenta del cliente la lee.
--
-- 2. Bucket público intranet-client-banners: un objeto por cliente con nombre =
--    client id, como intranet-client-logos. La subida va con URL firmada que arma
--    el server con service_role, así que no hacen falta políticas de Storage.
--
-- Correr en Supabase → SQL Editor (proyecto compartido: solo agrega una columna a
-- una tabla intranet_ y un bucket con prefijo intranet-).

alter table public.intranet_clients
  add column if not exists portal jsonb not null default '{}'::jsonb;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('intranet-client-banners', 'intranet-client-banners', true, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

notify pgrst, 'reload schema';
