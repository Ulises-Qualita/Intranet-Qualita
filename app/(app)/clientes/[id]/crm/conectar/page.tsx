import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, NoAccess } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { crmProviderLabel } from "@/lib/crm-shared";
import { getCrmSecrets } from "@/lib/crm-sync";
import { getClient } from "@/lib/data";
import { relativeTime, todayISO } from "@/lib/format";
import { CrmForm } from "./crm-form";
import { DisconnectCrmButton } from "./disconnect-button";
import { LeadBase } from "./lead-base";
import { WonStages } from "./won-stages";

export default async function ConectarCrmPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getAreaSession("clientes");
  if (!session) {
    return (
      <>
        <NoAccess />
      </>
    );
  }

  const client = await getClient(id);
  if (!client) notFound();

  const state = client.integrations.crm;
  const secrets = state.connected ? await getCrmSecrets(client.id) : null;

  return (
    <>
      <section className="view">
        <p className="back-link">
          <Link href={`/clientes/${client.slug}/crm`}>← Volver a CRM</Link>
        </p>

        <Card
          title={`CRM · ${client.name}`}
          hint={state.connected ? `Conectado: ${state.accountRef}` : undefined}
          action={state.connected ? <DisconnectCrmButton clientId={client.id} /> : undefined}
          className="meta-connect"
        >
          {secrets?.sync_error && <p className="form-error">{secrets.sync_error}</p>}
          {secrets?.synced_at && !secrets.sync_error && (
            <p className="modal-lead">
              Sincronizado {relativeTime(secrets.synced_at)} desde {crmProviderLabel(secrets.provider)}. Se actualiza solo dos
              veces por día.
            </p>
          )}
          <p className="modal-lead">
            Las credenciales quedan guardadas del lado del servidor y no vuelven a mostrarse. Para cambiarlas, cargalas de nuevo.
          </p>

          <CrmForm clientId={client.id} current={secrets?.provider ?? null} />
        </Card>

        {secrets?.stage_order?.length ? (
          <Card
            title="Qué cuenta como venta ganada"
            hint="Afecta las ganadas y la tasa de conversión"
            className="mt-4"
          >
            <p className="modal-lead">
              El CRM deja de marcar la oportunidad como ganada cuando avanza a una etapa posterior (producción, entrega,
              post venta). Tildá todas las etapas que ya significan venta cerrada.
            </p>
            <WonStages clientId={client.id} stages={secrets.stage_order} selected={secrets.won_stages ?? []} />
          </Card>
        ) : null}

        {secrets?.stage_order?.length ? (
          <Card
            title="Qué leads se cuentan"
            hint="Afecta todas las métricas del CRM"
            className="mt-4"
          >
            <p className="modal-lead">
              No todo lo que el CRM tiene cargado es una consulta nueva. Indicá desde qué día el registro es completo (lo
              anterior no se cuenta) y qué etapas son pruebas o uso interno. Además se dejan afuera solos los leads de
              contactos que ya estaban en el CRM antes del lead (clientes anteriores que volvieron a escribir) y los
              repetidos con el mismo teléfono.
            </p>
            <LeadBase
              clientId={client.id}
              stages={secrets.stage_order}
              since={secrets.since ?? ""}
              excluded={secrets.excluded_stages ?? []}
              today={todayISO()}
            />
          </Card>
        ) : null}
      </section>
    </>
  );
}
