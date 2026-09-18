-- Anuncio que originó la oportunidad, tal como lo carga el CRM (en Odoo es una
-- propiedad del lead). El nombre coincide con el del anuncio en Meta, así que
-- permite ver qué creatividad trae leads y cuáles terminan en venta.
-- Lo escribe el sync (lib/crm-sync.ts).

alter table public.intranet_leads
  add column if not exists ad text;
