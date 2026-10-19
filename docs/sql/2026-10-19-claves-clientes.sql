-- Contraseñas de las cuentas de clientes, para poder volver a verlas en
-- Administración → Cuentas de clientes ("Ver acceso").
--
-- Supabase Auth guarda solo el hash (no se puede recuperar), así que la intranet
-- guarda una copia cifrada (AES-256-GCM, lib/client-passwords.ts) al crear la cuenta
-- o cambiarle la contraseña. Tabla aparte de intranet_client_users porque esa la
-- lee la propia cuenta del cliente; esta no la lee nadie con sesión: RLS activada
-- y sin políticas, solo service_role (las acciones de /admin, que exigen admin).
-- Se borra sola con el usuario de Auth.
--
-- Correr en Supabase → SQL Editor (proyecto compartido: solo crea una tabla intranet_).

create table if not exists public.intranet_client_passwords (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  password_enc text not null,
  updated_at   timestamptz not null default now()
);

alter table public.intranet_client_passwords enable row level security;
