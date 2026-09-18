-- intranet_meta_ads pasa de snapshot (una fila por anuncio) a serie diaria
-- (una fila por anuncio y día). Es lo que permite que la vista de META sume el
-- período que elija el usuario (7 / 30 / 90 días) sin volver a pegarle a Meta.
--
-- El sync (lib/meta-sync.ts) hace upsert sobre la clave nueva.

alter table public.intranet_meta_ads
  drop constraint if exists intranet_meta_ads_client_id_ad_external_id_key;

alter table public.intranet_meta_ads
  add constraint intranet_meta_ads_client_id_ad_external_id_as_of_key
  unique (client_id, ad_external_id, as_of);

-- La vista siempre filtra por cliente y rango de fechas.
create index if not exists intranet_meta_ads_client_as_of_idx
  on public.intranet_meta_ads (client_id, as_of desc);
