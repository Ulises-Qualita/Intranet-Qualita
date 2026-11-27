-- Cerebros internos de Qualita: la skill descargable de cada área
-- (/clientes/qualita/cerebros/<área> → Skill). Ver .claude/rules/cerebros.md.
--
-- intranet_brain_skills: una fila por versión generada. Claude la escribe con los
-- criterios y aprendizajes guardados del área (intranet_brain_meetings) y queda
-- como SKILL.md (content), que se descarga en un .zip para subir a Claude o
-- copiar a .claude/skills. version sube de a uno por área; se muestra la última.
-- criteria_count / meetings_count: con cuántos criterios y reuniones se armó.
-- criteria_keys: una huella de cada criterio usado (criterionKey en
-- lib/brain-skills-shared.ts), para avisar cuántos hay nuevos y cuántos se
-- borraron desde esa versión.
--
-- RLS activada sin políticas: la intranet la lee y escribe con service_role
-- después de validar la sesión (equipo con el área clientes).
--
-- Correr en Supabase → SQL Editor, el archivo entero (proyecto compartido: solo
-- crea objetos con el prefijo intranet_).

create table if not exists public.intranet_brain_skills (
  id              uuid primary key default gen_random_uuid(),
  area            text not null,
  version         integer not null,
  name            text not null,
  content         text not null,
  criteria_count  integer not null default 0,
  meetings_count  integer not null default 0,
  criteria_keys   text[] not null default '{}',
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (area, version)
);

create index if not exists intranet_brain_skills_area_idx
  on public.intranet_brain_skills (area, version desc);

-- Si la tabla ya se había creado sin la columna:
alter table public.intranet_brain_skills
  add column if not exists criteria_keys text[] not null default '{}';

alter table public.intranet_brain_skills enable row level security;
