-- Quién está en línea (página de Equipo), con Supabase Realtime Presence.
--
-- No hay tabla: cada navegador con la intranet abierta se anuncia en el canal
-- `intranet:presence` y Realtime lleva la cuenta (si se cierra la pestaña o se
-- corta la conexión, desaparece solo a los pocos segundos).
--
-- El canal es privado: la anon key está en el front, así que en un canal
-- público cualquiera, sin cuenta, podría ver quién está conectado o anunciarse
-- como otro. (Entre miembros no hay forma de atar la clave de presencia al
-- auth.uid() desde una política; para un indicador interno alcanza.)
-- Estas políticas sobre realtime.messages dejan leer y anunciarse solo a
-- miembros activos de la intranet, y solo en este tema: no abren ningún otro
-- canal ni tocan nada del otro proyecto (las políticas se suman con OR).
--
-- Correr en Supabase → SQL Editor. Hasta que se corra, la app funciona igual y
-- simplemente no muestra quién está en línea.

drop policy if exists "intranet_presence_read" on realtime.messages;
create policy "intranet_presence_read"
  on realtime.messages for select
  to authenticated
  using (
    realtime.topic() = 'intranet:presence'
    and extension = 'presence'
    and exists (select 1 from public.intranet_profiles p where p.id = auth.uid() and p.active)
  );

drop policy if exists "intranet_presence_track" on realtime.messages;
create policy "intranet_presence_track"
  on realtime.messages for insert
  to authenticated
  with check (
    realtime.topic() = 'intranet:presence'
    and extension = 'presence'
    and exists (select 1 from public.intranet_profiles p where p.id = auth.uid() and p.active)
  );
