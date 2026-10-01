-- Habilita el proveedor 'drive' en las tablas de integraciones.
--
-- La carpeta de Google Drive de cada cliente se guarda en
-- intranet_client_integrations (provider 'drive', account_ref = id de la
-- carpeta). Las dos tablas tienen un CHECK sobre `provider` y 'drive' no estaba:
-- sin esto, vincular la carpeta falla con 23514 (check_violation).
--
-- Igual que 2026-09-18-clarity-provider.sql: el nombre del constraint se busca en
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
      'alter table public.%I add constraint %I check (provider in (''meta'', ''notion'', ''crm'', ''clarity'', ''drive'', ''whatsapp''))',
      tabla,
      tabla || '_provider_check'
    );
  end loop;
end $$;

-- Refrescar el schema cache de PostgREST.
notify pgrst, 'reload schema';
