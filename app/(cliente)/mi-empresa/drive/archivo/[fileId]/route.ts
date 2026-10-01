import { serveDriveFile } from "@/lib/drive-download";

// Descarga para la cuenta de un cliente: siempre de su propia carpeta (lib/drive-download.ts).
export async function GET(_request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  return serveDriveFile(fileId, null);
}
