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
