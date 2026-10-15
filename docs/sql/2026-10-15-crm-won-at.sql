-- Fecha de la venta de cada oportunidad (intranet_leads.won_at).
--
-- Una venta cuenta en el mes en que pasó a ganada, no en el que se creó el lead
-- (un lead de agosto que se vende en octubre es una venta de octubre). La carga el
-- sync del CRM (lib/crm-sync.ts):
-- - Odoo: la primera entrada a una etapa ganada, según el historial de etapas.
-- - Kommo: el cierre como ganada (closed_at).
-- - Con planilla de ventas: la fecha de confirmación de la planilla.
-- null si no se sabe (p. ej. leads anteriores al historial de Odoo): la vista usa
-- la fecha de creación.
--
-- Correr en Supabase → SQL Editor (proyecto compartido: solo toca intranet_leads).
-- Después, el próximo sync del CRM la completa; no hace falta reconectar.

alter table public.intranet_leads add column if not exists won_at timestamptz;

notify pgrst, 'reload schema';
