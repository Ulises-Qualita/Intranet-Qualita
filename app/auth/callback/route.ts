import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_MEMBER_AREAS, isQualitaEmail } from "@/lib/auth-shared";
import { createAdminClient, createClient } from "@/lib/supabase/server";

// Destino del OAuth de Google: canjea el code por la sesión y valida el dominio.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next");
  const safeNext = next?.startsWith("/") && !next.startsWith("//") ? next : "/";

  if (!code) return NextResponse.redirect(new URL("/login?error=auth", origin));

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) return NextResponse.redirect(new URL("/login?error=auth", origin));

  if (!isQualitaEmail(data.user?.email)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/login?error=dominio", origin));
  }

  // Primer ingreso de alguien que ya estaba en Auth por el otro app (el trigger solo
  // crea el perfil al registrarse): se le crea con las áreas por defecto.
  // ignoreDuplicates: un perfil existente (o desactivado por un admin) no se toca.
  const user = data.user!;
  const meta = user.user_metadata ?? {};
  await createAdminClient()
    .from("intranet_profiles")
    .upsert(
      {
        id: user.id,
        email: user.email,
        full_name: meta.full_name ?? meta.name ?? null,
        role: "member",
        areas: DEFAULT_MEMBER_AREAS,
        active: true,
      },
      { onConflict: "id", ignoreDuplicates: true },
    );

  return NextResponse.redirect(new URL(safeNext, origin));
}
