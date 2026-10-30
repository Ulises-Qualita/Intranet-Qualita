-- Carpeta de la solapa Guías (videos tutoriales de las plataformas del cliente).
--
-- Es una carpeta DENTRO de la carpeta de Drive del cliente (provider 'drive' de
-- intranet_client_integrations), elegida en /clientes/[slug]/guias/conectar. Se
-- guarda su id acá; null = todavía no se eligió. Al cambiar o desvincular la
-- carpeta de Drive, la intranet la vuelve a null (ya no estaría adentro).
--
-- Mientras no se corra, la solapa Guías muestra "sin carpeta" y elegirla avisa
-- que falta este archivo.
--
-- Correr en Supabase → SQL Editor.

alter table public.intranet_clients add column if not exists guides_folder text;

-- Refrescar el schema cache de PostgREST.
notify pgrst, 'reload schema';
