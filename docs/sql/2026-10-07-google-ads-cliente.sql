-- La cuenta del cliente lee sus totales diarios de Google Ads.
--
-- La Vista general (también en /mi-empresa) suma la inversión de Meta y de Google
-- Ads. La solapa GADS sigue siendo solo del equipo: las campañas
-- (intranet_gads_campaigns) no se abren, solo los totales por día de su propia
-- cuenta, igual que intranet_meta_daily.
--
-- Correr en Supabase → SQL Editor. Requiere 2026-10-07-google-ads.sql y
-- 2026-09-25-cuentas-clientes.sql (intranet_my_client_id).

drop policy if exists "intranet_gads_daily_client_user" on public.intranet_gads_daily;
create policy "intranet_gads_daily_client_user"
  on public.intranet_gads_daily for select to authenticated
  using (client_id = public.intranet_my_client_id());

notify pgrst, 'reload schema';
