// Miniaturas y videos de Drive con links firmados. Solo server.
//
// Una carpeta puede tener decenas de imágenes: validar con isInside cada miniatura
// serían decenas de consultas a Drive por pantalla. Con un video es peor: el
// navegador lo pide en tramos, cientos de pedidos por reproducción. En cambio, la
// vista (que ya validó la carpeta) firma un link por archivo con HMAC y
// vencimiento, y la ruta solo verifica la firma. Sin firma válida no se sirve nada.
import { createHmac, timingSafeEqual } from "node:crypto";
import { fetchMediaRange, fetchThumbnail, isDriveId } from "./drive";

const THUMB_TTL_S = 60 * 60;
// Un video largo se mira de corrido o se deja en pausa un rato: más margen.
const VIDEO_TTL_S = 6 * 60 * 60;

type Purpose = "thumb" | "video";

// La clave de la cuenta de servicio ya es un secreto del server: se deriva de ahí
// en vez de sumar otra variable de entorno. Cada uso tiene su clave, así un link
// de miniatura no sirve para bajar el video.
const sign = (purpose: Purpose, payload: string) =>
  createHmac("sha256", `drive-${purpose}:${process.env.GOOGLE_SERVICE_ACCOUNT_KEY}`).update(payload).digest("base64url");

// "<id>.<vence>.<firma>": todo apto para una URL (los ids de Drive son [\w-]).
// El vencimiento se redondea: la URL queda igual entre renders (el navegador la
// reusa de su cache) y vale entre una y dos veces el TTL.
function makeToken(purpose: Purpose, ttl: number, fileId: string, now: number) {
  const exp = Math.ceil((now / 1000 + ttl) / ttl) * ttl;
  const payload = `${fileId}.${exp}`;
  return `${payload}.${sign(purpose, payload)}`;
}

export const thumbToken = (fileId: string, now = Date.now()) => makeToken("thumb", THUMB_TTL_S, fileId, now);
export const videoToken = (fileId: string, now = Date.now()) => makeToken("video", VIDEO_TTL_S, fileId, now);

function verify(purpose: Purpose, token: string): string | null {
  const [id, exp, sig] = token.split(".");
  if (!isDriveId(id) || !/^\d+$/.test(exp ?? "") || !sig) return null;
  if (Number(exp) < Date.now() / 1000) return null;
  const expected = Buffer.from(sign(purpose, `${id}.${exp}`));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given) ? id : null;
}

// La sirven /api/drive/thumb/[token] (equipo) y /mi-empresa/drive/thumb/[token] o
// /mi-empresa/guias/thumb/[token] (cuenta del cliente: proxy.ts no la deja salir de
// /mi-empresa).
export async function serveThumb(token: string) {
  const id = verify("thumb", token);
  if (!id) return new Response("Link vencido o inválido", { status: 403 });
  try {
    const res = await fetchThumbnail(id);
    if (!res) return new Response("Sin vista previa", { status: 404 });
    return new Response(res.body, {
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "image/jpeg",
        // Mientras dure la firma, el navegador no la vuelve a pedir.
        "Cache-Control": `private, max-age=${THUMB_TTL_S}`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    console.error("[drive] miniatura", id, e);
    return new Response("No se pudo cargar la vista previa", { status: 502 });
  }
}

// Video de la solapa Guías, por tramos (Range). La sirven /api/drive/video/[token]
// (equipo) y /mi-empresa/guias/video/[token] (cuenta del cliente).
export async function serveVideo(token: string, range: string | null) {
  const id = verify("video", token);
  if (!id) return new Response("Link vencido o inválido", { status: 403 });
  try {
    const res = await fetchMediaRange(id, range);
    if (res.status === 416) {
      return new Response(null, { status: 416, headers: { "Content-Range": res.headers.get("content-range") ?? "bytes */*" } });
    }
    if (!res.ok) {
      console.error("[drive] video", id, res.status, await res.text().catch(() => ""));
      return new Response("No se pudo cargar el video", { status: res.status === 404 ? 404 : 502 });
    }
    const type = res.headers.get("content-type") ?? "";
    const headers = new Headers({
      // Solo se sirve como video: cualquier otra cosa sale como binario genérico.
      "Content-Type": type.startsWith("video/") ? type : "application/octet-stream",
      "Content-Disposition": "inline",
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    });
    for (const h of ["content-range", "content-length"]) {
      const value = res.headers.get(h);
      if (value) headers.set(h, value);
    }
    return new Response(res.body, { status: res.status, headers });
  } catch (e) {
    console.error("[drive] video", id, e);
    return new Response("No se pudo cargar el video", { status: 502 });
  }
}
