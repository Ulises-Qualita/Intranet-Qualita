import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, NoAccess } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { crmProviderLabel } from "@/lib/crm-shared";
import { getCrmSecrets } from "@/lib/crm-sync";
import { getClient } from "@/lib/data";
import { integer, relativeTime, todayISO } from "@/lib/format";
import { CrmForm } from "./crm-form";
import { DisconnectCrmButton } from "./disconnect-button";
import { LeadBase } from "./lead-base";
import { SalesSheet } from "./sales-sheet";
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

        {secrets ? (
          <Card title="Ventas desde una planilla" hint="Reemplaza las ventas y la facturación del CRM" className="mt-4">
            <p className="modal-lead">
              Si las ventas confirmadas se registran en una planilla de Google Sheets, la facturación sale de ahí y no del
              CRM. La planilla tiene que tener una pestaña <b>Proyectos</b> (número de proyecto, Teléfono, Total valor
              pesos, Total valor USD) y otra <b>Cotizaciones</b> (Nro. de Proyecto, Fecha confirmación de proyecto,
              Vendedor), y estar compartida con {process.env.GOOGLE_DRIVE_USER ?? "la cuenta de Drive del estudio"}. Cada
              venta se cruza por teléfono con el lead del CRM para saber de qué origen y anuncio vino. Los montos en pesos y
              en dólares se muestran por separado.
            </p>
            {secrets.sales_sheet && (
              <p className="modal-lead">
                Conectada:{" "}
                <a href={secrets.sales_sheet.url} target="_blank" rel="noreferrer">
                  {secrets.sales_sheet.title ?? "planilla"}
                </a>
                {secrets.sales_stats &&
                  `. Última lectura: ${integer(secrets.sales_stats.projects)} proyectos con fecha de confirmación, ${integer(
                    secrets.sales_stats.matched,
                  )} cruzados con un lead del CRM, ${integer(secrets.sales_stats.noPhone)} sin teléfono${
                    secrets.sales_stats.undated ? ` y ${integer(secrets.sales_stats.undated)} sin fecha de confirmación (no se cuentan)` : ""
                  }.`}
              </p>
            )}
            {secrets.sales_error && <p className="form-error">{secrets.sales_error}</p>}
            <SalesSheet clientId={client.id} current={secrets.sales_sheet?.url ?? null} />
          </Card>
        ) : null}

        {secrets?.stage_order?.length && !secrets.sales_sheet ? (
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
