import { serveDriveFile } from "@/lib/drive-download";

// Descarga de un archivo de Guías para la cuenta de un cliente: siempre de su propia carpeta.
export async function GET(_request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  return serveDriveFile(fileId, null, "guias");
}
