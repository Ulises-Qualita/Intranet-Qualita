import { LOGO_MAX_BYTES, LOGO_TYPES, LOGOS_BUCKET } from "@/lib/logos";
import { createClient } from "@/lib/supabase/client";
import { createLogoUpload, logoUploaded } from "./actions";

// Valida en el navegador, pide una URL firmada al server y sube directo a Storage.
// Devuelve un mensaje de error o null si salió bien.
export async function uploadClientLogo(clientId: string, file: File): Promise<string | null> {
  const invalid = validateLogo(file);
  if (invalid) return invalid;

  const signed = await createLogoUpload(clientId, { type: file.type, size: file.size });
  if (!signed.ok) return signed.error;

  const { error } = await createClient()
    .storage.from(LOGOS_BUCKET)
    .uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type, upsert: true });
  if (error) return "No se pudo subir el logo.";

  await logoUploaded();
  return null;
}

export function validateLogo(file: File): string | null {
  if (!LOGO_TYPES.includes(file.type)) return "Subí un PNG, JPG o WebP.";
  if (file.size > LOGO_MAX_BYTES) return "El logo no puede pesar más de 2 MB.";
  return null;
}
