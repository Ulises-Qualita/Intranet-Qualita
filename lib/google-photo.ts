// Foto de Google de alguien del equipo, para cuando el login no la trajo. Solo server.
//
// La foto sale de los datos que Google le pasa a Supabase al iniciar sesión
// (avatar_url / picture), pero a algunas cuentas Google no se la manda aunque la
// tengan (pasó con alejo@). Acá se pide con la cuenta de servicio, como ese
// usuario y con el scope de Drive que ya está delegado (lib/google.ts): `about`
// devuelve su photoLink, que es público.
import { unstable_cache } from "next/cache";
import { isQualitaEmail } from "./auth-shared";
import { GoogleAuthError, googleAccessToken, googleConfigured } from "./google";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

// Un día: la foto casi nunca cambia y esto corre en cada render del layout.
const fetchPhoto = unstable_cache(
  async (email: string): Promise<string | null> => {
    let token: string;
    try {
      token = await googleAccessToken(email, DRIVE_SCOPE);
    } catch (e) {
      // Cuenta que no existe o está suspendida en Workspace (invalid_grant): no va
      // a tener foto, y se cachea así para no reintentarlo en cada pantalla.
      if (e instanceof GoogleAuthError && e.code === "invalid_grant") return null;
      throw e;
    }
    const res = await fetch("https://www.googleapis.com/drive/v3/about?fields=user(photoLink)", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    // Tira para que un error no quede cacheado como "no tiene foto".
    if (!res.ok) throw new Error(`Google Drive respondió ${res.status}`);
    const body = (await res.json()) as { user?: { photoLink?: string } };
    // Viene en 64 px; =s200 la pide más grande para las fotos de Equipo.
    return body.user?.photoLink?.replace(/=s\d+$/, "=s200") ?? null;
  },
  ["google-photo"],
  { revalidate: 86_400 },
);

export async function googlePhoto(email: string | null | undefined): Promise<string | null> {
  if (!email || !isQualitaEmail(email) || !googleConfigured()) return null;
  try {
    return await fetchPhoto(email.toLowerCase());
  } catch (e) {
    console.error("[google-photo]", email, e instanceof Error ? e.message : e);
    return null;
  }
}
