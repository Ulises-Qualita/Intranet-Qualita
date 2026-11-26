-- Reportes cargados a mano y reportes comparativos (solapa Reportes).
--
-- - kind: 'generado' (el de siempre), 'manual' (un PDF o HTML hecho fuera de la
--   intranet, subido al historial) o 'comparativo' (el mes contra los dos
--   reportes anteriores, docs/Reporte_Bimenstral_Comparativo.pdf).
-- - metrics: los números del reporte (lib/report/metrics.ts). Un comparativo
--   compara contra los metrics de los reportes guardados, no recalcula. Los
--   generados los guardan solos; en los manuales los saca Claude del archivo y
--   el equipo los revisa antes de guardar.
-- - file_path / file_name: el archivo del reporte manual, en el bucket privado
--   intranet-client-reports (se sirve por /api/reportes/[id], que valida acceso).
-- - compared_ids: contra qué reportes se armó un comparativo.
-- - html deja de ser obligatorio: un reporte manual no tiene HTML propio.
--
-- Correr en Supabase → SQL Editor (proyecto compartido; solo toca tablas
-- intranet_ y crea un bucket nuevo con ese prefijo).

alter table public.intranet_client_reports
  add column if not exists kind text not null default 'generado',
  add column if not exists metrics jsonb,
  add column if not exists file_path text,
  add column if not exists file_name text,
  add column if not exists compared_ids uuid[];

alter table public.intranet_client_reports alter column html drop not null;

alter table public.intranet_client_reports drop constraint if exists intranet_client_reports_kind_check;
alter table public.intranet_client_reports
  add constraint intranet_client_reports_kind_check check (kind in ('generado', 'manual', 'comparativo'));

-- Bucket privado, sin políticas: se sube con una URL firmada que arma el server
-- (después de validar el acceso) y se lee con service_role.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('intranet-client-reports', 'intranet-client-reports', false, 20971520, array['application/pdf', 'text/html'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

notify pgrst, 'reload schema';
