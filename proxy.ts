import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isQualitaEmail } from "@/lib/auth-shared";

// /api/cron/ no lleva sesión de usuario: lo llama el cron de Vercel y cada ruta
// valida por su cuenta el header con CRON_SECRET.
const PUBLIC_PATHS = ["/login", "/auth/", "/api/cron/"];

// Zona de las cuentas de clientes (mail + contraseña). Todo lo demás es del equipo.
const CLIENT_ZONE = "/mi-empresa";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    },
  );

  // Refresca la sesión si hace falta y valida el JWT.
  const { data } = await supabase.auth.getClaims();
  const email = data?.claims?.email as string | undefined;
  const signedIn = Boolean(data?.claims);
  // Equipo = cuenta @qualita.studio. Cualquier otra sesión es (o intenta ser) una
  // cuenta de cliente: queda encerrada en /mi-empresa, cuyo layout valida que la
  // cuenta exista y esté activa. Cada página del equipo vuelve a exigir su perfil.
  const staff = signedIn && isQualitaEmail(email);

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p));
  const inClientZone = pathname === CLIENT_ZONE || pathname.startsWith(`${CLIENT_ZONE}/`);

  const redirectTo = (path: string) => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = "";
    const redirect = NextResponse.redirect(url);
    // Conservar las cookies de sesión refrescadas.
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  };

  if (!signedIn && !isPublic) return redirectTo("/login");
  if (signedIn && pathname === "/login") return redirectTo(staff ? "/" : CLIENT_ZONE);
  if (signedIn && !staff && !isPublic && !inClientZone) return redirectTo(CLIENT_ZONE);
  if (staff && inClientZone) return redirectTo("/");

  return response;
}

export const config = {
  matcher: [
    // Todo menos estáticos, optimización de imágenes y archivos de public/.
    "/((?!_next/static|_next/image|favicon.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
