import { NextResponse, type NextRequest } from "next/server";
import { getAreaSession } from "@/lib/auth";
import { META_OAUTH_COOKIE, exchangeCode, metaRedirectUri, saveMetaSecrets } from "@/lib/meta";

// Vuelta del login de Facebook: valida el state, guarda el token del lado server
// y lleva a elegir el portfolio y la cuenta publicitaria.
export async function GET(request: NextRequest) {
  const { origin, searchParams } = request.nextUrl;

  let pending: { state: string; clientId: string; slug: string } | null = null;
  try {
    pending = JSON.parse(request.cookies.get(META_OAUTH_COOKIE)?.value ?? "null");
  } catch {}

  const finish = (path: string, error?: string) => {
    const url = new URL(path, origin);
    if (error) url.searchParams.set("error", error);
    const response = NextResponse.redirect(url);
    response.cookies.delete({ name: META_OAUTH_COOKIE, path: "/api/integraciones/meta" });
    return response;
  };

  if (!(await getAreaSession("clientes"))) return finish("/");
  if (!pending || pending.state !== searchParams.get("state")) return finish("/clientes");

  const target = `/clientes/${pending.slug}/meta/conectar`;
  const code = searchParams.get("code");
  if (!code) return finish(target, "cancelado");

  try {
    await saveMetaSecrets(pending.clientId, await exchangeCode(code, metaRedirectUri(origin)));
  } catch (e) {
    console.error("[meta] callback", e);
    return finish(target, "login");
  }
  return finish(target);
}
