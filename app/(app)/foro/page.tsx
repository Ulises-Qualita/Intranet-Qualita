import { Topbar } from "@/components/topbar";
import { Card, EmptyState } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { getThreads } from "@/lib/forum";
import { ForumList } from "./forum-list";
import { NewPost } from "./new-post";

// El foro es de toda la intranet, no de un área: alcanza con tener la cuenta
// activa, igual que el agente.
export default async function ForoPage() {
  const session = await getSession();
  if (!session?.profile?.active) {
    return (
      <>
        <Topbar crumb="Qualita" title="Foro" />
        <section className="view">
          <Card title="Foro">
            <EmptyState label="Sin acceso">Tu cuenta todavía no está habilitada en la intranet.</EmptyState>
          </Card>
        </section>
      </>
    );
  }

  const { threads, sinTabla } = await getThreads();
  const abiertos = threads.filter((t) => t.status === "abierto" || t.status === "en_curso").length;

  return (
    <>
      <Topbar crumb="Qualita" title="Foro" />
      <section className="view view-column">
        {/* Sin descripción de la sección: la explicación del foro va en el mensaje
            fijado, escrito por el equipo. */}
        {!sinTabla && (
          <div className="view-actions view-actions-right">
            {threads.length > 0 && <span className="muted">{abiertos} sin cerrar</span>}
            <NewPost />
          </div>
        )}

        {sinTabla ? (
          <Card title="Foro">
            <EmptyState label="Sin configurar">
              Falta crear las tablas del foro: correr <code>docs/sql/2026-09-18-foro.sql</code> en Supabase.
            </EmptyState>
          </Card>
        ) : threads.length ? (
          <ForumList threads={threads} currentUserId={session.user.id} isAdmin={session.profile.role === "admin"} />
        ) : (
          <Card title="Todavía no hay nada">
            <EmptyState label="Vacío">
              Contá un error que te encontraste o una mejora que se te ocurra, con el botón “Nuevo mensaje”.
            </EmptyState>
          </Card>
        )}
      </section>
    </>
  );
}
