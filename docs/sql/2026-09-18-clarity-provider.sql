-- Habilita el proveedor 'clarity' en las tablas de integraciones.
--
-- Las dos tablas tienen un CHECK sobre `provider` con la lista de proveedores
-- válidos, y 'clarity' no estaba. Sin esto, conectar Clarity falla con
-- 23514 (check_violation) al guardar el token.
--
-- El nombre del constraint se busca en el catálogo en vez de darlo por sentado:
-- la convención de Postgres es <tabla>_<columna>_check, pero si alguna se creó a
-- mano puede llamarse distinto y un DROP por nombre fijo no la encontraría.
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
    -- Constraints de tipo CHECK que mencionan la columna provider.
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
      'alter table public.%I add constraint %I check (provider in (''meta'', ''notion'', ''crm'', ''clarity'', ''whatsapp''))',
      tabla,
      tabla || '_provider_check'
    );
  end loop;
end $$;

-- Refrescar el schema cache de PostgREST.
notify pgrst, 'reload schema';
