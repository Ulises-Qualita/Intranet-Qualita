import { SyncStatus } from "@/components/sync-status";
import { Topbar } from "@/components/topbar";
import { Card, EmptyState, MissingIntegration, NotConnected } from "@/components/ui";
import type { Client } from "@/lib/data";
import {
  type DriveCrumb,
  type DriveItem,
  driveConfigured,
  driveErrorMessage,
  isDownloadable,
  isDriveId,
  listFolder,
  pathFrom,
} from "@/lib/drive";
import { thumbToken } from "@/lib/drive-thumb";
import { fileSize, localDate, longDate, shortDate, todayISO } from "@/lib/format";
import { type BrowserItem, DriveBrowser, type FileKind } from "./drive-browser";

// Carpeta de Drive de un cliente. La usan el equipo (/clientes/[slug]/drive) y
// la cuenta del cliente (/mi-empresa/drive): quien la llama ya validó el acceso.
// `folder` es la subcarpeta que se está mirando (?carpeta=); se verifica que esté
// dentro de la carpeta del cliente, y si no, se muestra la raíz.
export async function DriveView({
  client,
  base,
  internal,
  folder,
}: {
  client: Client;
  base: string;
  internal: boolean;
  folder?: string;
}) {
  const title = "Drive";
  const head = !internal && <Topbar crumb={client.name} title={title} />;
  const { connected, accountRef } = client.integrations.drive;

  if (!driveConfigured()) {
    return (
      <>
        {head}
        <section className="view">
          {internal ? (
            <Card title={title}>
              <EmptyState label="No configurado">
                Falta la cuenta de Google del estudio: GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_KEY y
                GOOGLE_DRIVE_USER en las variables de entorno.
              </EmptyState>
            </Card>
          ) : (
            <NotConnected kind="drive" />
          )}
        </section>
      </>
    );
  }

  if (!connected || !isDriveId(accountRef)) {
    return (
      <>
        {head}
        <section className="view">
          <MissingIntegration kind="drive" client={client} internal={internal} />
        </section>
      </>
    );
  }

  const target = isDriveId(folder) ? folder : accountRef;
  let crumbs: DriveCrumb[] | null = null;
  let items: DriveItem[] = [];
  let error: string | null = null;
  try {
    // Una subcarpeta que no existe o no está dentro de la del cliente se trata como la raíz.
    const inside = target !== accountRef ? await pathFrom(accountRef, target).catch(() => null) : null;
    crumbs = inside ?? (await pathFrom(accountRef, accountRef));
    items = crumbs ? await listFolder(crumbs.at(-1)!.id) : [];
  } catch (e) {
    console.error("[drive]", client.slug, e);
    error = driveErrorMessage(e);
  }

  const here = crumbs?.at(-1);
  // Las rutas del cliente quedan dentro de /mi-empresa (proxy.ts no lo deja salir).
  const downloadHref = (id: string) => (internal ? `/api/drive/${id}?cliente=${client.slug}` : `${base}/drive/archivo/${id}`);
  const thumbHref = (id: string) => (internal ? `/api/drive/thumb/${thumbToken(id)}` : `${base}/drive/thumb/${thumbToken(id)}`);
  const folderHref = (id: string) => (id === accountRef ? `${base}/drive` : `${base}/drive?carpeta=${id}`);

  const browserItems: BrowserItem[] = items.map((f) => ({
    id: f.id,
    name: f.name,
    kind: fileKind(f),
    href: f.isFolder ? folderHref(f.id) : isDownloadable(f) ? downloadHref(f.id) : null,
    thumb: !f.isFolder && f.hasThumbnail ? thumbHref(f.id) : null,
    // Solo el equipo: el cliente no tiene acceso a la carpeta en Drive.
    openUrl: internal ? f.webViewLink : null,
    modified: f.modifiedTime,
    modifiedLabel: f.modifiedTime ? modifiedLabel(f.modifiedTime) : "—",
    size: f.isFolder ? null : f.size,
    sizeLabel: f.isFolder ? "—" : fileSize(f.size),
  }));

  return (
    <>
      {head}
      <section className="view">
        <SyncStatus source="Google Drive" live error={error} internal={internal} />

        {crumbs && here && (
          <div className="card drive-card">
            <DriveBrowser
              crumbs={crumbs.map((c, i) => ({ label: i === 0 ? client.name : c.name, href: folderHref(c.id) }))}
              items={browserItems}
              upload={{ slug: internal ? client.slug : null, folderId: here.id, folderName: here.name }}
            />
          </div>
        )}
      </section>
    </>
  );
}

// "hoy 10:32", o "12 sept" (con el año si no es el actual), en hora de Argentina.
function modifiedLabel(iso: string) {
  const day = localDate(iso);
  if (day === todayISO()) {
    return `hoy ${new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(iso))}`;
  }
  return day.slice(0, 4) === todayISO().slice(0, 4) ? shortDate(day) : longDate(day);
}

// Tipo de archivo para el ícono, por MIME (y la extensión cuando el MIME es genérico).
function fileKind(f: DriveItem): FileKind {
  const m = f.mimeType;
  const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
  if (f.isFolder) return "folder";
  if (m === "application/pdf" || ext === "pdf") return "pdf";
  if (m.includes("document") || m.includes("msword") || ["doc", "docx", "odt", "rtf", "txt"].includes(ext)) return "doc";
  if (m.includes("spreadsheet") || m.includes("excel") || ["xls", "xlsx", "csv", "ods"].includes(ext)) return "sheet";
  if (m.includes("presentation") || m.includes("powerpoint") || ["ppt", "pptx", "key", "odp"].includes(ext)) return "slide";
  if (m.startsWith("image/") || m.includes("drawing")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (m.includes("zip") || m.includes("compressed") || ["zip", "rar", "7z"].includes(ext)) return "zip";
  return "file";
}
