import { cache } from "react";
import { canAccess, isQualitaEmail, type AreaKey, type Profile } from "./auth-shared";
import { createClient } from "./supabase/server";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
};

export type Session = { user: SessionUser; profile: Profile | null };

// Usuario + perfil de la intranet, memorizado por request.
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims || !isQualitaEmail(claims.email as string | undefined)) return null;

  const meta = (claims.user_metadata ?? {}) as Record<string, string | undefined>;
  const email = claims.email as string;

  const { data: profile } = await supabase
    .from("intranet_profiles")
    .select("id, email, full_name, role, areas, active")
    .eq("id", claims.sub)
    .maybeSingle<Profile>();

  return {
    user: {
      id: claims.sub,
      email,
      name: meta.full_name || meta.name || profile?.full_name || email.split("@")[0],
      avatarUrl: meta.avatar_url || meta.picture || null,
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
// cuenta de cliente. La fila se lee con la sesión: la RLS solo deja ver la propia.
export const getClientSession = cache(async (): Promise<ClientSession | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const email = claims?.email as string | undefined;
  if (!claims || !email || isQualitaEmail(email)) return null;

  const { data: row } = await supabase
    .from("intranet_client_users")
    .select("client_id, active")
    .eq("user_id", claims.sub)
    .maybeSingle<{ client_id: string; active: boolean }>();
  if (!row) return null;

  return { userId: claims.sub, email, clientId: row.client_id, active: row.active };
});
