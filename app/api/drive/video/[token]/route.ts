import { serveVideo } from "@/lib/drive-thumb";

// Video de Guías para el equipo, por tramos: el token firmado lo arma GuiasView (lib/drive-thumb.ts).
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return serveVideo(token, request.headers.get("range"));
}
