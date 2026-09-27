-- Puesto de cada miembro del equipo (Diseñador, Project manager, …).
--
-- Es solo una etiqueta para mostrar: no da ni quita permisos (eso sigue siendo
-- role + areas). Lo define un admin desde /admin; la política de UPDATE de
-- intranet_profiles ya exige admin, así que no hace falta una nueva.
--
-- Lo ven el equipo (/equipo, pestaña Equipo de cada cliente) y las cuentas de
-- clientes en /mi-empresa/equipo, que lo leen del server con service_role.
--
-- Correr en Supabase → SQL Editor.

alter table public.intranet_profiles
  add column if not exists job_title text;
