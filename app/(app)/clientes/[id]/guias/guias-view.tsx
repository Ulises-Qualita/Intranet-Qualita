import { SyncStatus } from "@/components/sync-status";
import { Topbar } from "@/components/topbar";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { Card, EmptyState } from "@/components/ui";
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
import { sourceRoot } from "@/lib/drive-access";
import { thumbToken, videoToken } from "@/lib/drive-thumb";
import { fileKind, modifiedLabel } from "../drive/drive-view";
import { type GuideItem, GuiasBrowser } from "./guias-browser";

// Videos tutoriales de las plataformas de un cliente: una carpeta elegida DENTRO
// de su carpeta de Drive (intranet_clients.guides_folder), con la misma lógica de
// acceso que la solapa Drive. La
// usan el equipo (/clientes/[slug]/guias) y la cuenta del cliente
// (/mi-empresa/guias): quien la llama ya validó el acceso. `folder` es la
// subcarpeta que se mira (?carpeta=); si no está dentro de la raíz, se muestra la raíz.
// Solo lectura: los videos se suben y ordenan en Drive.
export async function GuiasView({
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
  const title = "Guías";
  const head = !internal && <Topbar crumb={client.name} title={title} />;
  const accountRef = sourceRoot(client, "guias");

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
            <NoGuides internal={false} />
          )}
        </section>
      </>
    );
  }

  if (!accountRef) {
    return (
      <>
        {head}
        <section className="view">
          <NoGuides internal={internal} slug={client.slug} hasDrive={client.conn.drive} />
        </section>
      </>
    );
  }

  const target = isDriveId(folder) ? folder : accountRef;
  let crumbs: DriveCrumb[] | null = null;
  let items: DriveItem[] = [];
  let error: string | null = null;
  try {
    const inside = target !== accountRef ? await pathFrom(accountRef, target).catch(() => null) : null;
    crumbs = inside ?? (await pathFrom(accountRef, accountRef));
    items = crumbs ? await listFolder(crumbs.at(-1)!.id) : [];
  } catch (e) {
    console.error("[guias]", client.slug, e);
    error = driveErrorMessage(e);
  }

  // Las rutas del cliente quedan dentro de /mi-empresa (proxy.ts no lo deja salir).
  const downloadHref = (id: string) =>
    internal ? `/api/drive/${id}?cliente=${client.slug}&de=guias` : `${base}/guias/archivo/${id}`;
  const thumbHref = (id: string) => (internal ? `/api/drive/thumb/${thumbToken(id)}` : `${base}/guias/thumb/${thumbToken(id)}`);
  const videoHref = (id: string) => (internal ? `/api/drive/video/${videoToken(id)}` : `${base}/guias/video/${videoToken(id)}`);
  const folderHref = (id: string) => (id === accountRef ? `${base}/guias` : `${base}/guias?carpeta=${id}`);

  const guideItems: GuideItem[] = items.map((f) => {
    const kind = fileKind(f);
    return {
      id: f.id,
      name: kind === "video" ? f.name.replace(/\.[a-z0-9]{2,4}$/i, "") : f.name,
      kind,
      href: f.isFolder ? folderHref(f.id) : isDownloadable(f) ? downloadHref(f.id) : null,
      video: kind === "video" ? videoHref(f.id) : null,
      thumb: !f.isFolder && f.hasThumbnail ? thumbHref(f.id) : null,
      durationMs: f.durationMs,
      // Solo el equipo: el cliente no tiene acceso a la carpeta en Drive.
      openUrl: internal ? f.webViewLink : null,
      modifiedLabel: f.modifiedTime ? modifiedLabel(f.modifiedTime) : "",
    };
  });

  return (
    <>
      {head}
      <section className="view">
        <SyncStatus source="Google Drive" live error={error} internal={internal} />

        {crumbs && crumbs.length > 0 && (
          <div className="card drive-card">
            <GuiasBrowser
              crumbs={crumbs.map((c, i) => ({ label: i === 0 ? "Guías" : c.name, href: folderHref(c.id) }))}
              items={guideItems}
            />
          </div>
        )}
      </section>
    </>
  );
}

// Sin carpeta de guías. El equipo ve el camino para elegirla (antes, la de Drive
// si falta); la cuenta del cliente, solo un aviso.
function NoGuides({ internal, slug, hasDrive }: { internal: boolean; slug?: string; hasDrive?: boolean }) {
  return (
    <div className="card connect-state">
      <div className="cs-ico">
        <Icon name="play" />
      </div>
      {internal && slug ? (
        <>
          <h3>{hasDrive ? "Elegí la carpeta de guías" : "Primero vinculá la carpeta de Drive"}</h3>
          <p>
            {hasDrive
              ? "Elegí, dentro del Drive de este cliente, la carpeta con los videos tutoriales de sus plataformas. Se reproducen acá mismo, sin salir de la intranet."
              : "Las guías son una carpeta dentro del Drive del cliente: vinculá primero su carpeta de Drive y después elegí la de los videos."}
          </p>
          <Link href={`/clientes/${slug}/${hasDrive ? "guias" : "drive"}/conectar`} className="connect-btn">
            {hasDrive ? "Elegir carpeta de guías" : "Vincular carpeta de Drive"}
          </Link>
        </>
      ) : (
        <>
          <h3>Las guías todavía no están disponibles.</h3>
          <p>Tu equipo de Qualita lo configura. Cuando esté listo, los videos aparecen acá.</p>
        </>
      )}
    </div>
  );
}
