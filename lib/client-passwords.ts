// Copia cifrada de las contraseñas de las cuentas de clientes, para que un admin
// las pueda volver a ver (Auth guarda solo el hash). Solo server: usa
// service_role y la tabla no tiene políticas de RLS.
// docs/sql/2026-10-19-claves-clientes.sql
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createAdminClient, isMissingTable } from "./supabase/server";

const TABLE = "intranet_client_passwords";

// Clave propia si está (CLIENT_PASSWORDS_KEY); si no, derivada de la service_role,
// que ya es el secreto más fuerte del server. Si cambia, las guardadas dejan de
// leerse y hay que generar una nueva contraseña.
function key() {
  const secret = process.env.CLIENT_PASSWORDS_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createHash("sha256").update(`intranet-client-passwords:${secret}`).digest();
}

function encrypt(text: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

function decrypt(value: string) {
  const [iv, tag, data] = value.split(".").map((p) => Buffer.from(p, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv!);
  decipher.setAuthTag(tag!);
  return Buffer.concat([decipher.update(data!), decipher.final()]).toString("utf8");
}

// No corta el alta ni el cambio si falla: la cuenta sirve igual, solo no se va a
// poder ver la contraseña después.
export async function storeClientPassword(userId: string, password: string) {
  const { error } = await createAdminClient()
    .from(TABLE)
    .upsert({ user_id: userId, password_enc: encrypt(password), updated_at: new Date().toISOString() });
  if (error && !isMissingTable(error)) console.error("[client-passwords] store", error);
}

export type StoredPassword =
  | { state: "ok"; password: string }
  | { state: "none" } // creada antes de guardarlas, o falló al guardar
  | { state: "missing-table" }
  | { state: "unreadable" }; // cambió la clave de cifrado

export async function readClientPassword(userId: string): Promise<StoredPassword> {
  const { data, error } = await createAdminClient()
    .from(TABLE)
    .select("password_enc")
    .eq("user_id", userId)
    .maybeSingle<{ password_enc: string }>();
  if (error) {
    if (isMissingTable(error)) return { state: "missing-table" };
    throw error;
  }
  if (!data) return { state: "none" };
  try {
    return { state: "ok", password: decrypt(data.password_enc) };
  } catch {
    return { state: "unreadable" };
  }
}
