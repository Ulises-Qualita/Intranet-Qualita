-- Habilita el proveedor 'search_console' en las tablas de integraciones (solapa SEO).
--
-- La solapa SEO dejó de usar SE Ranking: la propiedad de Google Search Console de
-- cada cliente se guarda en intranet_client_integrations (provider
-- 'search_console', account_ref = siteUrl, p. ej. 'sc-domain:ejemplo.com').
-- Las dos tablas tienen un CHECK sobre `provider`: sin esto, vincular la propiedad
-- falla con 23514 (check_violation).
--
-- 'seranking' queda en la lista para no romper las filas viejas (la app ya no las
-- lee). Igual que 2026-11-02-seranking-provider.sql. La lista debe coincidir con
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
      'alter table public.%I add constraint %I check (provider in (''meta'', ''google_ads'', ''notion'', ''crm'', ''clarity'', ''drive'', ''seranking'', ''search_console'', ''whatsapp''))',
      tabla,
      tabla || '_provider_check'
    );
  end loop;
end $$;

-- Refrescar el schema cache de PostgREST.
notify pgrst, 'reload schema';
