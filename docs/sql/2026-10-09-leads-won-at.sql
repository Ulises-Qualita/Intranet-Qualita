-- Cuándo se ganó cada oportunidad.
--
-- Las ganadas se contaban por la fecha de creación del lead: una venta cerrada
-- en octubre de un lead de septiembre no figuraba en octubre. stage_changed_at
-- (Odoo date_last_stage_update) no sirve para esto, porque cualquier cambio de
-- etapa posterior (Toma de medidas → En fábrica) lo pisa.
--
-- El sync (lib/crm-sync.ts) la completa:
-- - Odoo: el último paso a una etapa ganada, del historial de etapas
--   (mail.tracking.value; getOdooWonDates en lib/odoo.ts).
-- - Kommo: closed_at.
-- - Con planilla de ventas: la fecha de confirmación de la primera venta.
-- null en las que no están ganadas; las vistas usan la fecha de creación si falta.
--
-- Correr en Supabase → SQL Editor. Se completa con el próximo sync del CRM.

alter table public.intranet_leads
  add column if not exists won_at timestamptz;

notify pgrst, 'reload schema';
