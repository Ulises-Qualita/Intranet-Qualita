import Link from "next/link";
import { Topbar } from "@/components/topbar";
import { Card, EmptyState } from "@/components/ui";
import { UserAvatar } from "@/components/user-avatar";
import { type Client, getClientTeam } from "@/lib/data";

// Pestaña Equipo: quiénes de Qualita tienen asignado este cliente. La comparten
// el panel interno (/clientes/[slug]/equipo) y la cuenta del propio cliente
// (/mi-empresa/equipo): quien la llama ya validó el acceso. `internal` agrega
// el acceso a editar la asignación.
export async function EquipoView({ client, internal }: { client: Client; internal: boolean }) {
  const team = await getClientTeam(client.id);

  return (
    <>
      <Topbar crumb={client.name} title="Equipo" />
      <section className="view">
        {team.length === 0 ? (
          <Card title="Equipo asignado">
            <EmptyState label="Sin asignar">
              {internal ? (
                <>
                  Nadie del equipo tiene asignado este cliente.{" "}
                  <Link href={`/clientes/${client.slug}/editar`} className="link-connect">
                    Asignar equipo
                  </Link>
                </>
              ) : (
                "Todavía no hay personas de Qualita asignadas a tu cuenta."
              )}
            </EmptyState>
          </Card>
        ) : (
          <>
            {internal && (
              <div className="view-actions">
                <span className="muted">
                  {team.length === 1 ? "1 persona asignada" : `${team.length} personas asignadas`}
                </span>
                <Link href={`/clientes/${client.slug}/editar`} className="link-connect">
                  Editar asignación
                </Link>
              </div>
            )}
            <div className="grid g3">
              {team.map((m) => (
                <article key={m.id} className="card crew-card">
                  <UserAvatar className="team-av" name={m.name} avatarUrl={m.avatarUrl} />
                  <div className="team-id">
                    <h3>{m.name}</h3>
                    <span className={m.jobTitle ? "team-job" : "muted"}>{m.jobTitle ?? "Sin puesto definido"}</span>
                    {m.email && (
                      <a className="team-mail" href={`mailto:${m.email}`} title={m.email}>
                        {m.email}
                      </a>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </>
  );
}
