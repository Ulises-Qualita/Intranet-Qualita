-- Etiquetas de la oportunidad, con el nombre que se ve en el CRM (en Odoo,
-- tag_ids → crm.tag). Sirven para filtrar y agrupar leads desde el agente.
-- Lo escribe el sync (lib/crm-sync.ts).

alter table public.intranet_leads
  add column if not exists tags text[] not null default '{}';
