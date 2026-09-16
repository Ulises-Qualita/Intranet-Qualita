import Link from "next/link";
import { ClientAvatar } from "@/components/client-avatar";
import { Topbar } from "@/components/topbar";
import { Card, EmptyState, NoAccess } from "@/components/ui";
import { UserAvatar } from "@/components/user-avatar";
import { getAreaSession } from "@/lib/auth";
import { IntegrationDialog } from "@/components/integration-dialog";
import { getAllClients, getTeam } from "@/lib/data";
import { INTEGRATIONS } from "@/lib/integrations";
import { ClientStatusSelect } from "./client-status-select";
import { DeleteClientButton } from "./delete-client-button";
import { CreateClientDialog } from "./create-client-dialog";

export default async function ClientesPage() {
  const session = await getAreaSession("clientes");
  if (!session) {
    return (
      <>
        <Topbar crumb="Qualita" title="Clientes" />
        <NoAccess />
      </>
    );
  }

  const isAdmin = session.profile?.role === "admin";
  const [clients, team] = await Promise.all([getAllClients(), getTeam()]);
  const members = new Map(team.map((m) => [m.id, m]));

  return (
    <>
      <Topbar crumb="Qualita" title="Clientes" />
      <section className="view">
        <Card
          title={`Clientes · ${clients.length}`}
          action={<CreateClientDialog />}
        >
          {clients.length === 0 ? (
            <EmptyState label="Sin clientes">Todavía no hay clientes. Creá el primero con el botón “Crear cliente”.</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="ctable">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Responsables</th>
                    <th>Integraciones</th>
                    <th>Estado</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {clients.map((c) => {
                    const assignees = c.assigneeIds.map((id) => members.get(id)).filter((m) => m !== undefined);
                    return (
                      <tr key={c.id}>
                        <td>
                          <Link href={`/clientes/${c.slug}`} className="cl-cell">
                            <ClientAvatar client={c} />
                            <div>
                              <b>{c.name}</b>
                              <span>{[c.sector, c.domain].filter(Boolean).join(" · ") || "Sin rubro"}</span>
                            </div>
                          </Link>
                        </td>
                        <td>
                          {assignees.length === 0 ? (
                            <span className="muted">Sin asignar</span>
                          ) : (
                            <div className="av-stack" title={assignees.map((m) => m.name).join(", ")}>
                              {assignees.map((m) => (
                                <UserAvatar key={m.id} className="av" name={m.name} avatarUrl={m.avatarUrl} />
                              ))}
                            </div>
                          )}
                        </td>
                        <td>
                          <div className="chips">
                            {INTEGRATIONS.map(({ value }) => (
                              <IntegrationDialog
                                key={value}
                                clientId={c.id}
                                clientSlug={c.slug}
                                clientName={c.name}
                                provider={value}
                                state={c.integrations[value]}
                              />
                            ))}
                          </div>
                        </td>
                        <td>
                          <ClientStatusSelect clientId={c.id} status={c.status} name={c.name} />
                        </td>
                        <td>
                          <div className="row-actions">
                            <Link href={`/clientes/${c.slug}/editar`} className="link-connect">
                              Editar
                            </Link>
                            {isAdmin && <DeleteClientButton clientId={c.id} name={c.name} />}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>
    </>
  );
}
