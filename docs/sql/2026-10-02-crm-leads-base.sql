-- Qué leads del CRM cuentan como oportunidad nueva.
--
-- No todo lo que el CRM tiene como lead es una consulta nueva: hay pruebas del
-- equipo, leads cargados antes de que el cliente usara el CRM de verdad y, sobre
-- todo, clientes anteriores que volvieron a escribir (al conectar un WhatsApp,
-- Kommo importa la agenda del teléfono y cada contacto que escribe después nace
-- como "lead nuevo"). Ver docs/contexto-kommo.md.
--
-- El sync (lib/crm-sync.ts) los sigue guardando, pero marcados:
-- - contact_created_at: alta del contacto en el CRM (hoy solo Kommo).
-- - excluded: por qué no cuenta ('stage' | 'before_start' | 'returning' |
--   'duplicate', ver crmExclusions en lib/crm-shared.ts). null = cuenta.
--
-- lib/data.ts deja afuera los marcados en todas las vistas, el agente y los reportes.
--
-- Correr en Supabase → SQL Editor. Después, guardar "Qué leads se cuentan" en
-- /clientes/[slug]/crm/conectar (o esperar al próximo sync) para que se completen.

alter table public.intranet_leads
  add column if not exists contact_created_at timestamptz,
  add column if not exists excluded text;

notify pgrst, 'reload schema';
