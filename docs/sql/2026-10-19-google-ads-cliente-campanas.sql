-- La cuenta del cliente ve la solapa GADS en /mi-empresa/gads.
--
-- Los totales por día ya los leía (2026-10-07-google-ads-cliente.sql, para la
-- Vista general); la solapa además muestra la tabla de campañas, así que la cuenta
-- lee también las campañas de su propia empresa, igual que en META.
--
-- Correr en Supabase → SQL Editor. Requiere 2026-10-07-google-ads.sql y
-- 2026-09-25-cuentas-clientes.sql (intranet_my_client_id).

drop policy if exists "intranet_gads_campaigns_client_user" on public.intranet_gads_campaigns;
create policy "intranet_gads_campaigns_client_user"
  on public.intranet_gads_campaigns for select to authenticated
  using (client_id = public.intranet_my_client_id());

notify pgrst, 'reload schema';
