import { notFound } from "next/navigation";
import { Icon } from "@/components/icons";
import { Topbar } from "@/components/topbar";
import { Card, EmptyState, NoAccess } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { getClient, getTeam } from "@/lib/data";
import { longDate, relativeTime, todayISO } from "@/lib/format";
import { META_HISTORY_DAYS, shiftDate } from "@/lib/period";
import { createClient, isMissingTable } from "@/lib/supabase/server";
import { DeleteReportButton } from "./delete-report-button";
import { EditReportButton } from "./edit-report-button";
import { ReportForm } from "./report-form";

type ReportRow = {
  id: string;
  since: string;
  until: string;
  created_at: string;
  created_by: string | null;
  edited_at?: string | null;
};

const COLUMNS = "id, since, until, created_at, created_by";

export default async function ClienteReportesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Solo el panel del equipo: la cuenta del cliente no tiene esta solapa.
  const [session, client] = await Promise.all([getAreaSession("clientes"), getClient(id)]);
  if (!session) {
    return (
      <>
        <Topbar crumb="Clientes" title="Reportes" />
        <NoAccess />
      </>
    );
  }
  if (!client) notFound();

  const supabase = await createClient();
  const read = (columns: string) =>
    supabase
      .from("intranet_client_reports")
      .select(columns)
      .eq("client_id", client.id)
      .order("created_at", { ascending: false })
      .limit(50)
      .returns<ReportRow[]>();
  const [first, team] = await Promise.all([read(`${COLUMNS}, edited_at`), getTeam()]);
  // edited_at llega con docs/sql/2026-09-28-reportes-edicion.sql: sin ella se lista igual.
  const { data, error } = first.error?.code === "42703" ? await read(COLUMNS) : first;
  const missingTable = isMissingTable(error);
  // Cualquier otro error se muestra: tragarlo dejaba la lista vacía, como si no
  // hubiera reportes guardados.
  const readError = error && !missingTable ? (error.message ?? "error desconocido") : null;
  if (readError) console.error("[reportes] historial", client.id, error);
  const reports = data ?? [];
  const names = new Map(team.map((m) => [m.id, m.name]));
  const today = todayISO();

  return (
    <>
      <Topbar crumb={client.name} title="Reportes" />
      <section className="view report-view">
        <Card title="Nuevo reporte" hint="Mismo formato que el reporte mensual">
          {missingTable ? (
            <EmptyState label="Pendiente">Falta correr docs/sql/2026-09-28-reportes.sql en Supabase.</EmptyState>
          ) : (
            <ReportForm clientSlug={client.slug} today={today} oldest={shiftDate(today, META_HISTORY_DAYS)} />
          )}
        </Card>

        <Card title="Historial" hint={reports.length ? `${reports.length} generados` : undefined}>
          {readError ? (
            <p className="form-error">No se pudo leer el historial: {readError}</p>
          ) : reports.length === 0 ? (
            <EmptyState label="Sin reportes">Todavía no se generó ningún reporte para este cliente.</EmptyState>
          ) : (
            <ul className="report-list">
              {reports.map((r) => (
                <li key={r.id}>
                  <span className="report-list-ico">
                    <Icon name="doc" size={20} />
                  </span>
                  <div className="report-list-info">
                    <b>
                      {longDate(r.since)} – {longDate(r.until)}
                    </b>
                    <span>
                      <Icon name="clock" size={13} /> {relativeTime(r.created_at)}
                      {r.created_by && names.get(r.created_by) ? ` · ${names.get(r.created_by)}` : ""}
                      {r.edited_at ? ` · editado ${relativeTime(r.edited_at)}` : ""}
                    </span>
                  </div>
                  <div className="report-list-actions">
                    <a className="report-act" href={`/api/reportes/${r.id}`} target="_blank" rel="noopener" title="Ver reporte">
                      <Icon name="eye" size={16} />
                      <span>Ver</span>
                    </a>
                    <a className="report-act" href={`/api/reportes/${r.id}?descargar=1`} title="Descargar HTML">
                      <Icon name="download" size={16} />
                      <span>Descargar</span>
                    </a>
                    <EditReportButton clientSlug={client.slug} id={r.id} period={`${longDate(r.since)} – ${longDate(r.until)}`} />
                    <DeleteReportButton clientSlug={client.slug} id={r.id} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </>
  );
}
