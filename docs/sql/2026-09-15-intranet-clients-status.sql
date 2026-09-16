-- Estado comercial de cada cliente: lead → onboarding → cliente.
-- Correr en Supabase → SQL Editor (proyecto compartido; solo toca intranet_clients).

alter table public.intranet_clients
  add column if not exists status text not null default 'cliente';

alter table public.intranet_clients
  drop constraint if exists intranet_clients_status_check;

alter table public.intranet_clients
  add constraint intranet_clients_status_check
  check (status in ('lead', 'onboarding', 'cliente'));

-- Refrescar el schema cache de PostgREST para que la API vea la columna nueva.
notify pgrst, 'reload schema';
