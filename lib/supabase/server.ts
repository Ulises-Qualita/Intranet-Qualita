import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

// Una tabla que todavía no se creó (falta correr el SQL de docs/sql/) llega con
// dos códigos distintos según quién responda: PostgREST contesta PGRST205 porque
// no la encuentra en su schema cache, y Postgres 42P01 cuando la consulta igual
// llega a la base. Chequear solo uno deja el otro camino sin cubrir.
export const isMissingTable = (error: { code?: string } | null) =>
  error?.code === "PGRST205" || error?.code === "42P01";

// Cliente con la sesión del usuario: respeta RLS. Crear uno por request.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Llamado desde un Server Component: no puede escribir cookies.
            // El refresco de sesión lo resuelve proxy.ts.
          }
        },
      },
    },
  );
}

// Cliente con service_role: saltea RLS. Solo en el server y SIEMPRE después de
// validar el acceso del usuario (canAccess) en el mismo request.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
