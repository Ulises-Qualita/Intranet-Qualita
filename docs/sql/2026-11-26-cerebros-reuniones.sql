-- Cerebros internos de Qualita: reuniones cargadas a mano en cada área
-- (/clientes/qualita/cerebros/<área>). Ver .claude/rules/cerebros.md.
--
-- 1. intranet_brain_meetings: una reunión por fila, de un área (BRAIN_AREAS en
--    lib/brains.ts). Se guarda el texto original (transcripción, notas de Gemini
--    o el export de Claude meetings) y lo que Claude interpretó para esa área
--    (insights). status = 'borrador' mientras el equipo revisa la interpretación;
--    al confirmar pasa a 'guardada'. Un borrador abandonado no se muestra.
--    drive_ids: los documentos de Google de donde salió (para no cargarla dos veces).
-- 2. intranet_agent_usage.kind suma 'cerebro' (consumo de IA en /admin/gastos).
--
-- RLS activada sin políticas: la intranet la lee y escribe con service_role
-- después de validar la sesión (equipo con el área clientes).
--
-- Correr en Supabase → SQL Editor, el archivo entero (proyecto compartido: solo
-- crea objetos con el prefijo intranet_).

create table if not exists public.intranet_brain_meetings (
  id            uuid primary key default gen_random_uuid(),
  area          text not null,
  status        text not null default 'borrador' check (status in ('borrador', 'guardada')),
  source        text not null check (source in ('calendario', 'archivo', 'texto')),
  title         text not null,
  met_on        date,
  participants  jsonb not null default '[]'::jsonb,
  file_name     text,
  drive_ids     text[] not null default '{}',
  transcript    text not null,
  insights      jsonb not null,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists intranet_brain_meetings_area_idx
  on public.intranet_brain_meetings (area, status, met_on desc);

alter table public.intranet_brain_meetings enable row level security;

alter table public.intranet_agent_usage
  drop constraint if exists intranet_agent_usage_kind_check;
alter table public.intranet_agent_usage
  add constraint intranet_agent_usage_kind_check
  check (kind in ('agente', 'reporte', 'analisis', 'marca', 'cerebro'));
