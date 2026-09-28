-- Edición de reportes con Claude ("Hacer una modificación" en el historial).
--
-- Cada cambio pisa el html y guarda el anterior en previous_html, para poder
-- deshacer el último. edited_at marca el último cambio (null = sin editar).
--
-- Correr en Supabase → SQL Editor, después de 2026-09-28-reportes.sql.

alter table public.intranet_client_reports
  add column if not exists previous_html text,
  add column if not exists edited_at timestamptz;

notify pgrst, 'reload schema';
