// Cuenta de servicio de Google Workspace con delegación de dominio. Solo server.
//
// La cuenta actúa como un usuario del estudio (`sub`) con un scope puntual. Un
// super admin autoriza su client ID y los scopes en admin.google.com → Seguridad
// → Controles de API → Delegación de todo el dominio. Hoy: Calendar (lectura, en
// lib/calendar.ts) y Drive (lectura y subida, en lib/drive.ts). Los scopes de esa
// entrada se reemplazan al editarla: hay que dejar todos los que se usan.
import { createSign } from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

export function googleConfigured() {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
}

export class GoogleAuthError extends Error {
  // unauthorized_client = falta autorizar la delegación (o ese scope) en la consola de Workspace.
  constructor(
    message: string,
    readonly code: string | null,
  ) {
    super(message);
  }
}

const b64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

// Por instancia del server: evita firmar y canjear un JWT en cada consulta.
const tokens = new Map<string, { token: string; expires: number }>();

export async function googleAccessToken(email: string, scope: string) {
  const cacheKey = `${email}|${scope}`;
  const cached = tokens.get(cacheKey);
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;

  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(
    JSON.stringify({
      iss: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      sub: email,
      scope,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  )}`;
  // En Vercel la clave suele cargarse con los saltos de línea escapados.
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_KEY!.replace(/\\n/g, "\n");
  const signature = createSign("RSA-SHA256").update(unsigned).sign(key, "base64url");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
    cache: "no-store",
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.access_token) {
    throw new GoogleAuthError(body?.error_description ?? `Google respondió ${res.status}`, body?.error ?? null);
  }
  tokens.set(cacheKey, { token: body.access_token, expires: Date.now() + body.expires_in * 1000 });
  return body.access_token as string;
}
