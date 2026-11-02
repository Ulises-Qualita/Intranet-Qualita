-- Habilita el proveedor 'seranking' en las tablas de integraciones (solapa SEO).
--
-- El proyecto de SE Ranking de cada cliente se guarda en
-- intranet_client_integrations (provider 'seranking', account_ref = site_id).
-- Las dos tablas tienen un CHECK sobre `provider`: sin esto, vincular el proyecto
-- falla con 23514 (check_violation).
--
-- Igual que 2026-10-07-google-ads-provider.sql. La lista debe coincidir con
-- INTEGRATIONS en lib/integrations.ts.
--
-- Correr en Supabase → SQL Editor.

do $$
declare
  tabla text;
  restriccion text;
begin
  foreach tabla in array array['intranet_client_integrations', 'intranet_integration_secrets'] loop
    for restriccion in
      select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
      where ns.nspname = 'public'
        and rel.relname = tabla
        and con.contype = 'c'
        and pg_get_constraintdef(con.oid) ilike '%provider%'
    loop
      execute format('alter table public.%I drop constraint %I', tabla, restriccion);
    end loop;

    execute format(
      'alter table public.%I add constraint %I check (provider in (''meta'', ''google_ads'', ''notion'', ''crm'', ''clarity'', ''drive'', ''seranking'', ''whatsapp''))',
      tabla,
      tabla || '_provider_check'
    );
  end loop;
end $$;

-- Refrescar el schema cache de PostgREST.
notify pgrst, 'reload schema';
