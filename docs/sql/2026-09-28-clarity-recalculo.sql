-- Recalcula los días de Clarity ya guardados a partir de la respuesta cruda (raw).
--
-- Hasta este cambio el parser leía mal cuatro cosas y se perdían en la vista WEB:
--   - distinct_users: buscaba "distantUserCount" y Clarity manda "distinctUserCount".
--   - pages_per_session: buscaba "PagesPerSessionPercentage"; viene en minúscula.
--   - páginas más vistas: salían de un corte por URL que volvía vacío; la
--     respuesta general ya trae la lista en PopularPages.
--   - señales de fricción: una versión anterior guardaba las sesiones del día
--     (sessionsCount) en vez de la cantidad de cada señal (subTotal), así que
--     todas las cards mostraban el mismo número.
-- Además llena sources (origen del tráfico, desde ReferrerUrl) si la columna existe
-- (docs/sql/2026-09-28-reportes.sql).
--
-- No borra nada: completa lo que quedó en cero o vacío y corrige la fricción. Se puede correr más
-- de una vez. Correr en Supabase → SQL Editor.

-- Usuarios distintos y páginas por sesión (métrica Traffic).
update public.intranet_clarity_daily d
set
  distinct_users = coalesce(t.users, d.distinct_users),
  pages_per_session = coalesce(t.pages, d.pages_per_session)
from (
  select
    d2.id,
    sum((i ->> 'distinctUserCount')::numeric)::int as users,
    max((i ->> 'pagesPerSessionPercentage')::numeric) as pages
  from public.intranet_clarity_daily d2
  cross join lateral jsonb_array_elements(d2.raw) m
  cross join lateral jsonb_array_elements(m -> 'information') i
  where jsonb_typeof(d2.raw) = 'array' and m ->> 'metricName' = 'Traffic'
  group by d2.id
) t
where t.id = d.id;

-- Señales de fricción: subTotal de cada métrica. Un día sin la métrica en raw queda en 0.
update public.intranet_clarity_daily d
set
  rage_clicks = coalesce(f.rage, 0),
  dead_clicks = coalesce(f.dead, 0),
  excessive_scroll = coalesce(f.scroll, 0),
  quickbacks = coalesce(f.quick, 0),
  script_errors = coalesce(f.script, 0),
  error_clicks = coalesce(f.error, 0)
from (
  select
    d2.id,
    sum((i ->> 'subTotal')::numeric) filter (where m ->> 'metricName' = 'RageClickCount')::int as rage,
    sum((i ->> 'subTotal')::numeric) filter (where m ->> 'metricName' = 'DeadClickCount')::int as dead,
    sum((i ->> 'subTotal')::numeric) filter (where m ->> 'metricName' = 'ExcessiveScroll')::int as scroll,
    sum((i ->> 'subTotal')::numeric) filter (where m ->> 'metricName' = 'QuickbackClick')::int as quick,
    sum((i ->> 'subTotal')::numeric) filter (where m ->> 'metricName' = 'ScriptErrorCount')::int as script,
    sum((i ->> 'subTotal')::numeric) filter (where m ->> 'metricName' = 'ErrorClickCount')::int as error
  from public.intranet_clarity_daily d2
  cross join lateral jsonb_array_elements(d2.raw) m
  cross join lateral jsonb_array_elements(m -> 'information') i
  where jsonb_typeof(d2.raw) = 'array'
  group by d2.id
) f
where f.id = d.id;

-- Páginas más vistas (visitas por página).
insert into public.intranet_clarity_pages (id, client_id, as_of, url, sessions)
select gen_random_uuid(), d.client_id, d.as_of, i ->> 'url', (i ->> 'visitsCount')::int
from public.intranet_clarity_daily d
cross join lateral jsonb_array_elements(d.raw) m
cross join lateral jsonb_array_elements(m -> 'information') i
where jsonb_typeof(d.raw) = 'array'
  and m ->> 'metricName' = 'PopularPages'
  and coalesce(i ->> 'url', '') <> ''
  and coalesce((i ->> 'visitsCount')::int, 0) > 0
on conflict (client_id, as_of, url) do update set sessions = excluded.sessions;

-- Origen del tráfico, solo si ya existe la columna sources.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'intranet_clarity_daily' and column_name = 'sources'
  ) then
    update public.intranet_clarity_daily d
    set sources = s.list
    from (
      select
        d2.id,
        jsonb_agg(
          jsonb_build_object('name', coalesce(i ->> 'name', 'Directo'), 'sessions', (i ->> 'sessionsCount')::int)
          order by (i ->> 'sessionsCount')::int desc
        ) as list
      from public.intranet_clarity_daily d2
      cross join lateral jsonb_array_elements(d2.raw) m
      cross join lateral jsonb_array_elements(m -> 'information') i
      where jsonb_typeof(d2.raw) = 'array' and m ->> 'metricName' = 'ReferrerUrl'
      group by d2.id
    ) s
    where s.id = d.id and d.sources = '[]'::jsonb;
  end if;
end $$;
