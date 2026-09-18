-- Campaña a la que pertenece cada anuncio, para agrupar la tabla de la vista de
-- META. Los llena el sync (lib/meta-sync.ts) desde los insights de Meta.
-- Nullable: las filas sincronizadas antes de este cambio quedan sin campaña
-- hasta la próxima corrida completa (/api/cron/meta?full=1).

alter table public.intranet_meta_ads
  add column if not exists campaign_external_id text,
  add column if not exists campaign_name text;
