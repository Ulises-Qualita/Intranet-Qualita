-- Cerebros: reuniones cargadas desde la database de Reuniones de Notion
-- (Cargar información → Reunión → De Notion). Ver .claude/rules/cerebros.md.
--
-- Suma 'notion' a las fuentes posibles de intranet_brain_meetings. La página de
-- Notion se guarda en drive_ids como 'notion:<id sin guiones>' (para marcar las
-- "Ya cargadas"), así que no hace falta otra columna.
--
-- Correr en Supabase → SQL Editor (proyecto compartido: solo toca objetos
-- con el prefijo intranet_).

alter table public.intranet_brain_meetings
  drop constraint if exists intranet_brain_meetings_source_check;
alter table public.intranet_brain_meetings
  add constraint intranet_brain_meetings_source_check
  check (source in ('calendario', 'archivo', 'texto', 'notion'));
