-- Panel interno de Qualita: un "cliente" que es el propio estudio.
--
-- Es una fila más de intranet_clients marcada con internal = true, así tiene las
-- mismas solapas y tablas que cualquier cliente (/clientes/qualita). La intranet
-- la saca de las listas de clientes (sidebar, Inicio, Clientes, Administración,
-- el agente) y la muestra aparte, en la zona "Qualita" de la barra lateral.
--
-- La ven los admins y los miembros que tenga asignados, igual que un cliente
-- (docs/sql/2026-10-20-clientes-asignados.sql).
--
-- Mientras no se corra, la intranet funciona igual y la entrada no aparece.
--
-- Correr en Supabase → SQL Editor (proyecto compartido; solo toca intranet_clients).

alter table public.intranet_clients add column if not exists internal boolean not null default false;

-- Como mucho una fila interna.
create unique index if not exists intranet_clients_internal_unique on public.intranet_clients (internal) where internal;

insert into public.intranet_clients (id, name, slug, status, active, internal)
select gen_random_uuid(), 'Qualita interno', 'qualita', 'cliente', true, true
where not exists (select 1 from public.intranet_clients where internal);

-- Refrescar el schema cache de PostgREST.
notify pgrst, 'reload schema';
