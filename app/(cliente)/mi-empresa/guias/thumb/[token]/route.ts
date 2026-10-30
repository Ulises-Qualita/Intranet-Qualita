import { serveThumb } from "@/lib/drive-thumb";

// Miniatura de Guías para la cuenta de un cliente: el token firmado lo arma GuiasView (lib/drive-thumb.ts).
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return serveThumb(token);
}
