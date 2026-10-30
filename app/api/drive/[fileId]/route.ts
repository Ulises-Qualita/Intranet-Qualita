import { type NextRequest } from "next/server";
import { isDriveSource } from "@/lib/drive-access";
import { serveDriveFile } from "@/lib/drive-download";

// Descarga para el equipo: ?cliente=<slug> dice de qué cliente es y ?de=guias, si
// es de la carpeta de Guías en vez de la de Drive (lib/drive-download.ts).
export async function GET(request: NextRequest, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  const de = request.nextUrl.searchParams.get("de");
  return serveDriveFile(fileId, request.nextUrl.searchParams.get("cliente"), isDriveSource(de) ? de : "drive");
}
