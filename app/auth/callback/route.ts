import { NextResponse, type NextRequest } from "next/server";
import { isQualitaEmail } from "@/lib/auth-shared";
import { createClient } from "@/lib/supabase/server";

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

  return NextResponse.redirect(new URL(safeNext, origin));
}
