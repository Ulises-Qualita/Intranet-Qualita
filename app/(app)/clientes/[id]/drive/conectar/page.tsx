import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icons";
import { Card, EmptyState, NoAccess } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { getClient } from "@/lib/data";
import {
  type DriveCrumb,
  driveConfigured,
  driveErrorMessage,
  isDriveId,
  listFolder,
  listMyDriveFolders,
  listSharedDrives,
  listSharedWithMe,
  myDriveRootId,
  pathFrom,
  searchFolders,
} from "@/lib/drive";
import { ChooseFolderButton, DisconnectDriveButton } from "./folder-actions";

type Section = { title: string; folders: DriveCrumb[] };

// Elegir la carpeta de Drive del cliente. Las carpetas del estudio son carpetas
// compartidas sueltas (no hay una unidad compartida), así que se parte de tres
// lugares: "Compartido conmigo", "Mi unidad" y las unidades compartidas, más un
// buscador por nombre. Se navega con ?en=<carpeta> y se vincula la que se mira.
export default async function ConectarDrivePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ en?: string; buscar?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const session = await getAreaSession("clientes");
  if (!session) return <NoAccess />;

  const client = await getClient(id);
  if (!client) notFound();

  const base = `/clientes/${client.slug}/drive/conectar`;
  const state = client.integrations.drive;
  const at = isDriveId(query.en) ? query.en : null;
  const term = (query.buscar ?? "").trim().slice(0, 100);

  if (!driveConfigured()) {
    return (
      <section className="view view-column">
        <Card title="Carpeta de Drive">
          <EmptyState label="No configurado">
            Falta la cuenta de Google del estudio: GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_KEY y
            GOOGLE_DRIVE_USER en las variables de entorno.
          </EmptyState>
        </Card>
      </section>
    );
  }

  let sections: Section[] = [];
  let crumbs: DriveCrumb[] = [];
  let current: DriveCrumb[] | null = null;
  let blocked = false;
  let loadError: string | null = null;
  try {
    const [drives, currentPath] = await Promise.all([
      listSharedDrives(),
      state.connected && isDriveId(state.accountRef) ? pathFrom(null, state.accountRef).catch(() => null) : null,
    ]);
    current = currentPath;

    if (at) {
      const [path, subfolders, myRoot] = await Promise.all([pathFrom(null, at), listFolder(at, true), myDriveRootId()]);
      crumbs = path ?? [];
      sections = [{ title: "Subcarpetas", folders: subfolders }];
      // Ni "Mi unidad" entera ni una unidad compartida entera: el cliente vería todo.
      blocked = at === myRoot || drives.some((d) => d.id === at);
    } else if (term) {
      sections = [{ title: `Resultados para «${term}»`, folders: await searchFolders(term) }];
    } else {
      const [shared, mine] = await Promise.all([listSharedWithMe(), listMyDriveFolders()]);
      sections = [
        { title: "Compartido conmigo", folders: shared },
        { title: "Mi unidad", folders: mine },
        { title: "Unidades compartidas", folders: drives },
      ].filter((s) => s.folders.length > 0);
    }
  } catch (e) {
    console.error("[drive] conectar", e);
    loadError = driveErrorMessage(e);
  }

  const here = crumbs.at(-1);

  return (
    <section className="view view-column">
      <p className="back-link">
        <Link href={`/clientes/${client.slug}/drive`}>← Volver a Drive</Link>
      </p>

      <Card
        title={`Carpeta de Drive · ${client.name}`}
        action={state.connected ? <DisconnectDriveButton clientId={client.id} /> : undefined}
        className="drive-connect"
      >
        {current && (
          <p className="drive-current">
            <Icon name="folder" size={16} />
            Vinculada: <b>{current.map((c) => c.name).join(" / ")}</b>
          </p>
        )}
        <p className="modal-lead">
          Buscá la carpeta de <b>{client.name}</b> y elegila. Desde su cuenta, el cliente va a ver solo esa carpeta y lo
          que tenga adentro: puede descargar y subir archivos, pero no borrar ni crear carpetas.
        </p>

        <form className="drive-search" action={base}>
          <Icon name="folder" size={16} />
          <input
            name="buscar"
            defaultValue={term}
            placeholder="Buscar carpeta por nombre"
            autoComplete="off"
            aria-label="Buscar carpeta por nombre"
          />
          <button type="submit" className="btn-secondary">
            Buscar
          </button>
        </form>

        {(at || term) && (
          <nav className="drive-crumbs" aria-label="Ubicación">
            <Link href={base}>Drive</Link>
            {crumbs.map((c) => (
              <span key={c.id}>
                <span className="sep" aria-hidden>
                  /
                </span>
                <Link href={`${base}?en=${c.id}`}>{c.name}</Link>
              </span>
            ))}
          </nav>
        )}

        {loadError ? (
          <p className="form-error">{loadError}</p>
        ) : (
          <>
            {sections.length === 0 && !at && (
              <EmptyState label="Sin carpetas">
                {term
                  ? "Ninguna carpeta con ese nombre."
                  : `La cuenta de Drive de la intranet (${process.env.GOOGLE_DRIVE_USER}) no ve ninguna carpeta.`}
              </EmptyState>
            )}
            {sections.map((s) =>
              s.folders.length === 0 ? (
                <p key={s.title} className="muted drive-empty">
                  Esta carpeta no tiene subcarpetas.
                </p>
              ) : (
                <div key={s.title}>
                  <h4 className="drive-section">{s.title}</h4>
                  <FolderList items={s.folders} base={base} />
                </div>
              ),
            )}
            {here && (
              <div className="form-actions">
                {blocked ? (
                  <p className="muted">Elegí una carpeta de adentro: esta es la raíz de todo un Drive.</p>
                ) : (
                  <ChooseFolderButton
                    clientId={client.id}
                    clientSlug={client.slug}
                    folderId={here.id}
                    folderName={here.name}
                    current={state.accountRef === here.id}
                  />
                )}
              </div>
            )}
          </>
        )}
      </Card>
    </section>
  );
}

function FolderList({ items, base }: { items: DriveCrumb[]; base: string }) {
  return (
    <ul className="drive-folders">
      {items.map((f) => (
        <li key={f.id}>
          <Link href={`${base}?en=${f.id}`}>
            <Icon name="folder" size={17} />
            <span>{f.name}</span>
            <Icon name="chevron" size={15} strokeWidth={2} className="chev" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
