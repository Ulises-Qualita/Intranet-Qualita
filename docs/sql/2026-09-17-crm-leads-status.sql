-- Estado de cada lead en el CRM: 'open' (en el pipeline), 'won' (ganada) o
-- 'lost' (perdida/archivada). Lo escribe el sync (lib/crm-sync.ts) y es lo que
-- permite contar las oportunidades abiertas en la vista de CRM.
-- Nullable: las filas sincronizadas antes de este cambio quedan sin estado hasta
-- la próxima corrida.

alter table public.intranet_leads
  add column if not exists status text;

create index if not exists intranet_leads_client_status_idx
  on public.intranet_leads (client_id, status);
