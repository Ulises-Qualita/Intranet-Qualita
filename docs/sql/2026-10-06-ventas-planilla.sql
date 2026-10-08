-- Ventas confirmadas desde la planilla de Google Sheets del cliente (lib/sales-sheet.ts).
--
-- En Arteplac la venta no es confiable en Kommo: la fuente oficial es la planilla
-- de los vendedores. El sync del CRM la lee y guarda un registro por proyecto, con
-- la fecha de confirmación y el total separado en pesos y en dólares (no se
-- convierte). Cada venta se cruza por teléfono con el lead del CRM que la originó;
-- el teléfono no se guarda.
--
-- 1. intranet_crm_sales: una fila por proyecto confirmado.
-- 2. intranet_leads.amount_usd: la parte en dólares de la venta del lead (amount
--    queda con la parte en pesos).
--
-- Correr en Supabase → SQL Editor, el archivo entero (proyecto compartido: solo
-- crea objetos con el prefijo intranet_).

create table if not exists public.intranet_crm_sales (
  client_id        uuid not null references public.intranet_clients(id) on delete cascade,
  -- Número de proyecto de la planilla ("2026-4893").
  project          text not null,
  customer         text,
  confirmed_on     date not null,
  amount_ars       numeric,
  amount_usd       numeric,
  -- Vendedor y vía de contacto, como los cargan en la planilla.
  seller           text,
  channel          text,
  -- Lead del CRM que originó la venta (external_id de intranet_leads); null si
  -- no se encontró ninguno con el mismo teléfono.
  lead_external_id text,
  primary key (client_id, project)
);

create index if not exists intranet_crm_sales_client_date_idx
  on public.intranet_crm_sales (client_id, confirmed_on desc);

alter table public.intranet_crm_sales enable row level security;

-- Lectura: el equipo con el área CRM (o admin) y la cuenta del propio cliente,
-- igual que intranet_leads. La escritura la hace el sync con service_role.
drop policy if exists "intranet_crm_sales_team" on public.intranet_crm_sales;
create policy "intranet_crm_sales_team"
  on public.intranet_crm_sales for select
  using (
    exists (
      select 1 from public.intranet_profiles p
      where p.id = auth.uid() and p.active
        and (p.role = 'admin' or coalesce((p.areas ->> 'crm')::boolean, false))
    )
  );

drop policy if exists "intranet_crm_sales_client_user" on public.intranet_crm_sales;
create policy "intranet_crm_sales_client_user"
  on public.intranet_crm_sales for select to authenticated
  using (client_id = public.intranet_my_client_id());

alter table public.intranet_leads
  add column if not exists amount_usd numeric;

notify pgrst, 'reload schema';
