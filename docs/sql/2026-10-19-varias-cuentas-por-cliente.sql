-- Varias cuentas por cliente: cada persona de la empresa entra con su propio mail
-- y contraseña. Antes era una cuenta por empresa (client_id unique).
--
-- Nada más cambia: intranet_my_client_id() busca por user_id, que sigue siendo la
-- clave, así que las políticas de lectura de /mi-empresa valen igual.
--
-- Correr en Supabase → SQL Editor, el archivo entero.

alter table public.intranet_client_users
  drop constraint if exists intranet_client_users_client_id_key;

-- Sin el unique se pierde su índice: Administración lista y busca por cliente.
create index if not exists intranet_client_users_client_id_idx
  on public.intranet_client_users (client_id);

notify pgrst, 'reload schema';
