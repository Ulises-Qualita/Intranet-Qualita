import { servePortalImage } from "@/lib/notion-image";

// Portada o ícono del portal para el equipo: el link firmado lo arma PortalView (lib/notion-image.ts).
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return servePortalImage(token);
}
