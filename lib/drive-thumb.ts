// Miniaturas de Drive con links firmados. Solo server.
//
// Una carpeta puede tener decenas de imágenes: validar con isInside cada miniatura
// serían decenas de consultas a Drive por pantalla. En cambio, DriveView (que ya
// validó la carpeta) firma un link por archivo con HMAC y vencimiento, y la ruta
// de la miniatura solo verifica la firma. Sin firma válida no se sirve nada.
import { createHmac, timingSafeEqual } from "node:crypto";
import { fetchThumbnail, isDriveId } from "./drive";

const TTL_S = 60 * 60;

// La clave de la cuenta de servicio ya es un secreto del server: se deriva de ahí
// en vez de sumar otra variable de entorno.
const sign = (payload: string) =>
  createHmac("sha256", `drive-thumb:${process.env.GOOGLE_SERVICE_ACCOUNT_KEY}`).update(payload).digest("base64url");

// "<id>.<vence>.<firma>": todo apto para una URL (los ids de Drive son [\w-]).
// El vencimiento se redondea a la hora: la URL de una miniatura queda igual entre
// renders (el navegador la reusa de su cache) y vale entre una y dos horas.
export function thumbToken(fileId: string, now = Date.now()) {
  const exp = Math.ceil((now / 1000 + TTL_S) / TTL_S) * TTL_S;
  const payload = `${fileId}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

function verify(token: string): string | null {
  const [id, exp, sig] = token.split(".");
  if (!isDriveId(id) || !/^\d+$/.test(exp ?? "") || !sig) return null;
  if (Number(exp) < Date.now() / 1000) return null;
  const expected = Buffer.from(sign(`${id}.${exp}`));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given) ? id : null;
}

// La sirven /api/drive/thumb/[token] (equipo) y /mi-empresa/drive/thumb/[token]
// (cuenta del cliente: proxy.ts no la deja salir de /mi-empresa).
export async function serveThumb(token: string) {
  const id = verify(token);
  if (!id) return new Response("Link vencido o inválido", { status: 403 });
  try {
    const res = await fetchThumbnail(id);
    if (!res) return new Response("Sin vista previa", { status: 404 });
    return new Response(res.body, {
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "image/jpeg",
        // Mientras dure la firma, el navegador no la vuelve a pedir.
        "Cache-Control": `private, max-age=${TTL_S}`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    console.error("[drive] miniatura", id, e);
    return new Response("No se pudo cargar la vista previa", { status: 502 });
  }
}
