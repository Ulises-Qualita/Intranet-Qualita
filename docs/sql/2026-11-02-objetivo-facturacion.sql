-- Objetivo de facturación por cliente (Vista general, solo equipo). Se carga a mano.
--
-- Un monto en pesos por mes: {"2026-11": 5000000, "2027-01": 6000000}. Un mes sin
-- objetivo propio usa el del último mes cargado antes (lib/billing-goals.ts), así no
-- hay que cargarlo todos los meses si no cambia.
--
-- Correr en Supabase → SQL Editor.

alter table public.intranet_clients
  add column if not exists billing_goals jsonb not null default '{}'::jsonb;

notify pgrst, 'reload schema';
