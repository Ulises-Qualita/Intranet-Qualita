import Link from "next/link";
import { notFound } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { Card, NoAccess } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { getClaritySecrets } from "@/lib/clarity";
import { getClient } from "@/lib/data";
import { relativeTime } from "@/lib/format";
import { ClarityForm } from "./clarity-form";

export default async function ConectarClarityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getAreaSession("clientes");
  if (!session) {
    return (
      <>
        <Topbar crumb="Clientes" title="Conectar Clarity" />
        <NoAccess />
      </>
    );
  }

  const client = await getClient(id);
  if (!client) notFound();

  const state = client.integrations.clarity;
  const secrets = state.connected ? await getClaritySecrets(client.id) : null;

  return (
    <>
      <Topbar crumb={client.name} title="Conectar Clarity" />
      <section className="view view-column">
        <p className="back-link">
          <Link href={`/clientes/${client.slug}/web`}>← Volver a WEB</Link>
        </p>

        <Card title={`Microsoft Clarity · ${client.name}`} hint={state.connected ? "Conectado" : undefined}>
          {secrets?.sync_error && <p className="form-error">{secrets.sync_error}</p>}
          {secrets?.synced_at && !secrets.sync_error && (
            <p className="modal-lead">Última foto {relativeTime(secrets.synced_at)}. Se toma una por día.</p>
          )}

          <ol className="steps">
            <li>
              Entrá al proyecto del cliente en{" "}
              <a href="https://clarity.microsoft.com/" target="_blank" rel="noreferrer" className="link-connect">
                clarity.microsoft.com
              </a>{" "}
              y andá a <b>Settings → Data Export → Generate new API token</b>. Hace falta ser admin de ese proyecto.
            </li>
            <li>Copiá el token y pegalo acá abajo. Queda guardado del lado del servidor y no se vuelve a mostrar.</li>
            <li>
              El <b>ID del proyecto</b> sale de la URL del dashboard
              (<code>clarity.microsoft.com/projects/view/<b>ID</b>/dashboard</code>). Es opcional: solo sirve para identificar
              qué proyecto quedó vinculado en la matriz de integraciones.
            </li>
          </ol>

          <ClarityForm clientId={client.id} connected={state.connected} />
        </Card>

        <Card title="Qué esperar" className="mt-4">
          <ul className="notes">
            <li>
              Clarity permite <b>10 consultas por proyecto por día</b> y solo devuelve las últimas 72 horas. Por eso la
              intranet toma una foto diaria y arma la serie con ella, en vez de consultar cada vez que abrís la solapa.
            </li>
            <li>
              <b>El historial anterior no se puede traer.</b> Aunque el cliente tenga Clarity hace años, la solapa arranca
              vacía y se llena de acá en adelante.
            </li>
            <li>
              La API entrega números, no los mapas de calor ni las grabaciones. Eso se sigue mirando en Clarity.
            </li>
          </ul>
        </Card>
      </section>
    </>
  );
}
