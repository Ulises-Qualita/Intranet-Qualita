import { serveThumb } from "@/lib/drive-thumb";

// Miniatura de Drive para la cuenta del cliente: el token firmado lo arma DriveView (lib/drive-thumb.ts).
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return serveThumb(token);
}
