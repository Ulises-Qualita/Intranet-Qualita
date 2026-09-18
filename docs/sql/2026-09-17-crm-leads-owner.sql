-- Vendedor a cargo de cada oportunidad, tal como figura en el CRM. Lo escribe el
-- sync (lib/crm-sync.ts) y alimenta la tabla de ventas por vendedor en la vista
-- de CRM. Nullable: las filas anteriores quedan sin vendedor hasta el próximo sync.

alter table public.intranet_leads
  add column if not exists owner text;
