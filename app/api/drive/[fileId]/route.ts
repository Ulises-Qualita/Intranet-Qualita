import { type NextRequest } from "next/server";
import { serveDriveFile } from "@/lib/drive-download";

// Descarga para el equipo: ?cliente=<slug> dice de qué carpeta es (lib/drive-download.ts).
export async function GET(request: NextRequest, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  return serveDriveFile(fileId, request.nextUrl.searchParams.get("cliente"));
}
