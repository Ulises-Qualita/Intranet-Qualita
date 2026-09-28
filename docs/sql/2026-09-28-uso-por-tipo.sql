-- Consumo de IA separado por tipo: el agente, los reportes y (próximamente) los
-- análisis de campañas de META / Google Ads comparten intranet_agent_usage.
--
-- La lista debe coincidir con USAGE_KINDS en lib/agent/usage.ts.
--
-- Correr en Supabase → SQL Editor.

alter table public.intranet_agent_usage
  add column if not exists kind text not null default 'agente';

alter table public.intranet_agent_usage
  drop constraint if exists intranet_agent_usage_kind_check;
alter table public.intranet_agent_usage
  add constraint intranet_agent_usage_kind_check check (kind in ('agente', 'reporte', 'analisis'));

-- Los reportes generados antes de esta columna quedaron como 'agente'. Se
-- reconocen porque no tienen conversación y el mismo usuario guardó un reporte
-- dentro del minuto siguiente (el consumo se registra justo antes de guardarlo).
-- Solo corre si la tabla de reportes ya existe.
do $$
begin
  if to_regclass('public.intranet_client_reports') is not null then
    update public.intranet_agent_usage u
    set kind = 'reporte'
    where u.kind = 'agente'
      and u.thread_id is null
      and exists (
        select 1 from public.intranet_client_reports r
        where r.created_by = u.user_id
          and r.created_at between u.created_at and u.created_at + interval '1 minute'
      );
  end if;
end $$;

create index if not exists intranet_agent_usage_kind_idx
  on public.intranet_agent_usage (kind, created_at desc);

notify pgrst, 'reload schema';
