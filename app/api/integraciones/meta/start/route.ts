import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getAreaSession } from "@/lib/auth";
import { getAllClients } from "@/lib/data";
import { META_OAUTH_COOKIE, metaConfigured, metaDialogUrl, metaRedirectUri } from "@/lib/meta";

// Inicia el login con Facebook para conectar Meta a un cliente (?client=<slug>).
export async function GET(request: NextRequest) {
  const { origin, searchParams } = request.nextUrl;
  const slug = searchParams.get("client") ?? "";

  if (!(await getAreaSession("clientes"))) return NextResponse.redirect(new URL("/", origin));

  const client = (await getAllClients()).find((c) => c.slug === slug);
  if (!client) return NextResponse.redirect(new URL("/clientes", origin));

  const back = new URL(`/clientes/${client.slug}/meta/conectar`, origin);
  if (!metaConfigured()) {
    back.searchParams.set("error", "config");
    return NextResponse.redirect(back);
  }

  const state = randomBytes(24).toString("hex");
  const response = NextResponse.redirect(metaDialogUrl(state, metaRedirectUri(origin)));
  response.cookies.set(META_OAUTH_COOKIE, JSON.stringify({ state, clientId: client.id, slug: client.slug }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/integraciones/meta",
    maxAge: 600,
  });
  return response;
}
