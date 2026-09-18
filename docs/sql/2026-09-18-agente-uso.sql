-- Consumo del agente: una fila por consulta respondida.
--
-- El costo se calcula acá, en la intranet, a partir de los tokens que devuelve la
-- API de Anthropic, y NO es la factura: es una estimación del gasto de esta app.
-- Se guarda ya convertido a dólares (cost_usd) en vez de recalcularlo al mostrar,
-- porque los precios por millón de tokens cambian y una consulta de marzo tiene
-- que seguir valiendo lo que costó en marzo.
--
-- Por eso también se guarda el modelo: si mañana se cambia ANTHROPIC_MODEL, las
-- filas viejas siguen diciendo con cuál se respondieron.
--
-- Correr en Supabase → SQL Editor (proyecto compartido; solo crea una tabla nueva
-- con el prefijo intranet_, no toca nada del otro proyecto).

create table if not exists public.intranet_agent_usage (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users(id) on delete cascade,
  -- Se pone a null si después se borra la conversación: el gasto ya ocurrió y no
  -- tiene que desaparecer del panel porque alguien limpie su historial.
  thread_id              uuid references public.intranet_agent_threads(id) on delete set null,
  model                  text not null,
  input_tokens           integer not null default 0,
  output_tokens          integer not null default 0,
  -- Escribir en el cache cuesta ~1,25x un token de entrada; leerlo, ~0,1x.
  cache_creation_tokens  integer not null default 0,
  cache_read_tokens      integer not null default 0,
  cost_usd               numeric(10, 6) not null default 0,
  created_at             timestamptz not null default now()
);

create index if not exists intranet_agent_usage_created_idx
  on public.intranet_agent_usage (created_at desc);
create index if not exists intranet_agent_usage_user_idx
  on public.intranet_agent_usage (user_id, created_at desc);

alter table public.intranet_agent_usage enable row level security;

-- Escritura: cada uno registra lo suyo, con su propia sesión. No hay update ni
-- delete: es un registro de consumo, no un dato editable.
drop policy if exists "intranet_agent_usage_insert" on public.intranet_agent_usage;
create policy "intranet_agent_usage_insert"
  on public.intranet_agent_usage for insert
  with check (user_id = auth.uid());

-- Lectura: el admin ve todo (es lo que alimenta el panel) y cada uno lo propio.
drop policy if exists "intranet_agent_usage_select" on public.intranet_agent_usage;
create policy "intranet_agent_usage_select"
  on public.intranet_agent_usage for select
  using (user_id = auth.uid() or public.intranet_is_admin());

-- Refrescar el schema cache de PostgREST para que la API vea la tabla nueva.
notify pgrst, 'reload schema';
