import { cache } from "react";
import { canAccess, isQualitaEmail, type AreaKey, type Profile } from "./auth-shared";
import { googlePhoto } from "./google-photo";
import { createAdminClient, createClient } from "./supabase/server";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
};

export type Session = { user: SessionUser; profile: Profile | null };

// Lee la fila propia (perfil del equipo o cuenta de cliente) con service_role, por
// el id del JWT ya verificado con getClaims. Con el cliente de sesión, si el token
// se refrescaba en ese mismo request la consulta podía salir sin JWT (como anon):
// la RLS devolvía 0 filas y aparecía "Cuenta sin acceso" hasta volver a ingresar.
// Un error de red o de la base se reintenta una vez y después se lanza: nunca se
// toma un error como "no tiene acceso".
async function readOwnRow<T>(table: string, columns: string, column: string, userId: string): Promise<T | null> {
  for (let attempt = 0; ; attempt++) {
    const { data, error } = await createAdminClient()
      .from(table)
      .select(columns)
      .eq(column, userId)
      .maybeSingle<T>();
    if (!error) return data;
    if (attempt >= 1) throw new Error(`No se pudo leer ${table}: ${error.message}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

// Usuario + perfil de la intranet, memorizado por request.
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims || !isQualitaEmail(claims.email as string | undefined)) return null;

  const meta = (claims.user_metadata ?? {}) as Record<string, string | undefined>;
  const email = claims.email as string;

  const profile = await readOwnRow<Profile>(
    "intranet_profiles",
    "id, email, full_name, role, areas, active",
    "id",
    claims.sub,
  );

  return {
    user: {
      id: claims.sub,
      email,
      name: meta.full_name || meta.name || profile?.full_name || email.split("@")[0],
      avatarUrl: meta.avatar_url || meta.picture || (await googlePhoto(email)),
    },
    profile,
  };
});

// Para páginas: devuelve la sesión si el usuario puede ver el área, o null.
export async function getAreaSession(area: AreaKey) {
  const session = await getSession();
  return session && canAccess(session.profile, area) ? session : null;
}

// ---------- Cuentas de clientes (/mi-empresa) ----------

export type ClientSession = { userId: string; email: string; clientId: string; active: boolean };

// Cuenta de cliente con la que se está navegando, memorizada por request. null si
// no hay sesión, si es del equipo (esas usan getSession) o si el usuario no tiene
// cuenta de cliente. La fila se lee por el id del JWT verificado (readOwnRow).
export const getClientSession = cache(async (): Promise<ClientSession | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const email = claims?.email as string | undefined;
  if (!claims || !email || isQualitaEmail(email)) return null;

  const row = await readOwnRow<{ client_id: string; active: boolean }>(
    "intranet_client_users",
    "client_id, active",
    "user_id",
    claims.sub,
  );
  if (!row) return null;

  return { userId: claims.sub, email, clientId: row.client_id, active: row.active };
});
