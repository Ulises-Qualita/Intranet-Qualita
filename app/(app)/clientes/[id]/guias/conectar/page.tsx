import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icons";
import { Card, EmptyState, NoAccess } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { getClient } from "@/lib/data";
import { type DriveCrumb, driveConfigured, driveErrorMessage, isDriveId, listFolder, pathFrom } from "@/lib/drive";
import { ChooseGuidesButton, ClearGuidesButton } from "./guides-actions";

// Elegir la carpeta de Guías: se navega solo DENTRO de la carpeta de Drive del
// cliente (con ?en=<carpeta>) y se elige la que se está mirando.
export default async function ConectarGuiasPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ en?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const session = await getAreaSession("clientes");
  if (!session) return <NoAccess />;

  const client = await getClient(id);
  if (!client) notFound();

  const base = `/clientes/${client.slug}/guias/conectar`;
  const drive = client.integrations.drive;
  const back = (
    <p className="back-link">
      <Link href={`/clientes/${client.slug}/guias`}>← Volver a Guías</Link>
    </p>
  );

  if (!driveConfigured() || !drive.connected || !isDriveId(drive.accountRef)) {
    return (
      <section className="view view-column">
        {back}
        <Card title="Carpeta de guías">
          <EmptyState label="Falta la carpeta de Drive">
            Las guías se eligen dentro de la carpeta de Drive del cliente.{" "}
            <Link href={`/clientes/${client.slug}/drive/conectar`} className="link-connect">
              Vincular la carpeta de Drive →
            </Link>
          </EmptyState>
        </Card>
      </section>
    );
  }

  const root = drive.accountRef;
  let crumbs: DriveCrumb[] = [];
  let subfolders: DriveCrumb[] = [];
  let current: DriveCrumb[] | null = null;
  let loadError: string | null = null;
  try {
    // Una carpeta de ?en= que no esté dentro de la de Drive se trata como la raíz.
    const at = isDriveId(query.en) ? query.en : root;
    const [path, currentPath] = await Promise.all([
      pathFrom(root, at).then((p) => p ?? pathFrom(root, root)),
      client.guidesFolder ? pathFrom(root, client.guidesFolder).catch(() => null) : null,
    ]);
    crumbs = path ?? [];
    current = currentPath;
    subfolders = crumbs.length ? await listFolder(crumbs.at(-1)!.id, true) : [];
  } catch (e) {
    console.error("[guias] conectar", e);
    loadError = driveErrorMessage(e);
  }

  const here = crumbs.at(-1);
  const label = (c: DriveCrumb, i: number) => (i === 0 ? `Drive de ${client.name}` : c.name);

  return (
    <section className="view view-column">
      {back}

      <Card
        title={`Carpeta de guías · ${client.name}`}
        action={client.guidesFolder ? <ClearGuidesButton clientId={client.id} /> : undefined}
        className="drive-connect"
      >
        {current && (
          <p className="drive-current">
            <Icon name="play" size={16} />
            Elegida: <b>{current.map(label).join(" / ")}</b>
          </p>
        )}
        <p className="modal-lead">
          Entrá a la carpeta del Drive de <b>{client.name}</b> que tiene los videos tutoriales y elegila. Sus subcarpetas
          (una por plataforma, por ejemplo) se navegan desde la solapa. Desde su cuenta, el cliente solo mira los videos:
          no sube ni borra nada.
        </p>

        {crumbs.length > 0 && (
          <nav className="drive-crumbs" aria-label="Ubicación">
            {crumbs.map((c, i) => (
              <span key={c.id}>
                {i > 0 && (
                  <span className="sep" aria-hidden>
                    /
                  </span>
                )}
                <Link href={c.id === root ? base : `${base}?en=${c.id}`}>{label(c, i)}</Link>
              </span>
            ))}
          </nav>
        )}

        {loadError ? (
          <p className="form-error">{loadError}</p>
        ) : (
          <>
            {subfolders.length === 0 ? (
              <p className="muted drive-empty">Esta carpeta no tiene subcarpetas.</p>
            ) : (
              <ul className="drive-folders">
                {subfolders.map((f) => (
                  <li key={f.id}>
                    <Link href={`${base}?en=${f.id}`}>
                      <Icon name="folder" size={17} />
                      <span>{f.name}</span>
                      <Icon name="chevron" size={15} strokeWidth={2} className="chev" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {here && (
              <div className="form-actions">
                <ChooseGuidesButton
                  clientId={client.id}
                  clientSlug={client.slug}
                  folderId={here.id}
                  folderName={here.id === root ? `Drive de ${client.name}` : here.name}
                  current={client.guidesFolder === here.id}
                />
              </div>
            )}
          </>
        )}
      </Card>
    </section>
  );
}

