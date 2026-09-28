-- Solapas activables por cliente ("Editar cliente" → Solapas).
--
-- Guarda las solapas OCULTAS, por zona: {"team": [...], "client": [...]}. Vacío =
-- todas visibles, así un cliente nuevo o una solapa nueva aparecen sin tocar nada.
-- Las claves válidas están en CLIENT_TABS (lib/client-tabs.ts).
--
-- Correr en Supabase → SQL Editor.

alter table public.intranet_clients
  add column if not exists hidden_tabs jsonb not null default '{"team": [], "client": []}'::jsonb;

notify pgrst, 'reload schema';
