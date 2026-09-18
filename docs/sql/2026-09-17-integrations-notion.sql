-- Suma 'notion' a los proveedores permitidos en intranet_client_integrations.
-- El CHECK original se creó cuando solo existían meta / crm / whatsapp, así que
-- vincular un proyecto de Notion fallaba con 23514.
--
-- Correr en Supabase → SQL Editor, en el proyecto nkibbeidagckujxynsmf
-- (el compartido: tiene intranet_profiles y también companies/app_settings).

alter table public.intranet_client_integrations
  drop constraint if exists intranet_client_integrations_provider_check;

alter table public.intranet_client_integrations
  add constraint intranet_client_integrations_provider_check
  check (provider in ('meta', 'crm', 'whatsapp', 'notion'));

-- Mismo CHECK en la tabla de secretos, si lo tiene: hoy solo guarda el token de
-- Meta, pero conviene que ambas acepten el mismo conjunto de proveedores.
alter table public.intranet_integration_secrets
  drop constraint if exists intranet_integration_secrets_provider_check;

alter table public.intranet_integration_secrets
  add constraint intranet_integration_secrets_provider_check
  check (provider in ('meta', 'crm', 'whatsapp', 'notion'));

notify pgrst, 'reload schema';
