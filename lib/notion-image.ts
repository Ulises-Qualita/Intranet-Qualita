// Portada e ícono del portal del cliente con links estables. Solo server.
//
// Notion entrega los archivos subidos con una url firmada de S3 (us-west-2) que
// vence en 1 h y cambia en cada consulta. Usada directo en un <img>, el navegador
// nunca la reusa de su cache (cada 5 min es otra url) y baja la imagen de la otra
// punta del continente en cada visita. En cambio, PortalView (que ya validó el
// acceso al cliente) arma un link propio firmado con HMAC, igual que las
// miniaturas de Drive (lib/drive-thumb.ts), y la ruta le pide a Notion un link
// vigente y devuelve la imagen con cache largo.
//
// El link lleva una huella del archivo: mientras la imagen no cambie en Notion la
// url es la misma (y el navegador la tiene guardada); al cambiarla, cambia la url.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getPageImageUrls } from "./notion";

export type PortalImageKind = "cover" | "icon";

// El token de Notion ya es un secreto del server: se deriva de ahí en vez de
// sumar otra variable de entorno.
const sign = (payload: string) =>
  createHmac("sha256", `notion-img:${process.env.NOTION_TOKEN}`).update(payload).digest("base64url");

// Lo que identifica al archivo en la url firmada es el path; la query es la firma.
const fingerprint = (url: string) => createHash("sha256").update(new URL(url).pathname).digest("base64url").slice(0, 16);

const isSignedNotionFile = (url: string) => {
  try {
    return new URL(url).searchParams.has("X-Amz-Signature");
  } catch {
    return false;
  }
};

// src para el <img>. `base`: la ruta que sirve la imagen en la zona de quien mira.
// Devuelve la url tal cual si es externa (ya es estable) o si falta el id de la
// página (portal cacheado antes de este cambio).
export function portalImageSrc(base: string, pageId: string | undefined, kind: PortalImageKind, url: string) {
  if (!pageId || !process.env.NOTION_TOKEN || !isSignedNotionFile(url)) return url;
  const payload = `${pageId}.${kind}.${fingerprint(url)}`;
  return `${base}/${payload}.${sign(payload)}`;
}

function verify(token: string): { pageId: string; kind: PortalImageKind; print: string } | null {
  const [pageId, kind, print, sig] = token.split(".");
  if (!/^[0-9a-f-]{32,36}$/i.test(pageId ?? "") || (kind !== "cover" && kind !== "icon") || !print || !sig) return null;
  const expected = Buffer.from(sign(`${pageId}.${kind}.${print}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return { pageId, kind, print };
}

const YEAR_S = 365 * 24 * 60 * 60;

// La sirven /api/notion/img/[token] (equipo) y /mi-empresa/portal/img/[token]
// (cuenta del cliente: proxy.ts no la deja salir de /mi-empresa).
export async function servePortalImage(token: string) {
  const ref = verify(token);
  if (!ref) return new Response("Link inválido", { status: 403 });
  try {
    const url = (await getPageImageUrls(ref.pageId))[ref.kind];
    if (!url) return new Response("Sin imagen", { status: 404 });
    const res = await fetch(url, { cache: "no-store" });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.startsWith("image/")) return new Response("No se pudo cargar la imagen", { status: 502 });

    // La huella es parte de la url: si coincide, esta url siempre devuelve este
    // archivo y el navegador puede guardarlo sin volver a preguntar. Si la imagen
    // se cambió en Notion y alguien llega con un link viejo, se sirve la actual
    // sin guardarla.
    const current = fingerprint(url) === ref.print;
    return new Response(res.body, {
      headers: {
        "Content-Type": type,
        "Cache-Control": current ? `private, max-age=${YEAR_S}, immutable` : "private, no-store",
        "X-Content-Type-Options": "nosniff",
        // Un SVG abierto directo en esta url no puede ejecutar nada en el sitio.
        "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'",
      },
    });
  } catch (e) {
    console.error("[notion] imagen del portal", ref.pageId, ref.kind, e);
    return new Response("No se pudo cargar la imagen", { status: 502 });
  }
}
