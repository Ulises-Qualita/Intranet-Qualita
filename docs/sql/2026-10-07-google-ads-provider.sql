-- Habilita el proveedor 'google_ads' en las tablas de integraciones.
--
-- La cuenta de Google Ads de cada cliente se guarda en
-- intranet_client_integrations (provider 'google_ads', account_ref = customer id
-- de 10 dígitos, sin guiones). Las dos tablas tienen un CHECK sobre `provider`:
-- sin esto, vincular la cuenta falla con 23514 (check_violation).
--
-- Igual que 2026-09-30-drive-provider.sql: el nombre del constraint se busca en
-- el catálogo en vez de darlo por sentado.
--
-- La lista debe coincidir con INTEGRATIONS en lib/integrations.ts.
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
      'alter table public.%I add constraint %I check (provider in (''meta'', ''google_ads'', ''notion'', ''crm'', ''clarity'', ''drive'', ''whatsapp''))',
      tabla,
      tabla || '_provider_check'
    );
  end loop;
end $$;

-- Refrescar el schema cache de PostgREST.
notify pgrst, 'reload schema';
