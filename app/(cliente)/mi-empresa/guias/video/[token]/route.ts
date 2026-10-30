import { serveVideo } from "@/lib/drive-thumb";

// Video de Guías para la cuenta de un cliente (proxy.ts no la deja salir de /mi-empresa).
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return serveVideo(token, request.headers.get("range"));
}
