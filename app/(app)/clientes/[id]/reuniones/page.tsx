import { notFound } from "next/navigation";
import { NoAccess } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { canAccess } from "@/lib/auth-shared";
import { getClient } from "@/lib/data";
import { ReunionesView } from "./reuniones-view";

export default async function ClienteReunionesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Sin área propia, como Equipo: quien ve el panel del cliente ve sus reuniones.
  const [session, client] = await Promise.all([getAreaSession("clientes"), getClient(id)]);
  if (!session) {
    return (
      <>
        <NoAccess />
      </>
    );
  }
  if (!client) notFound();

  // Las tareas para la próxima reunión son del área Tareas, no de Clientes.
  return <ReunionesView client={client} internal withTasks={canAccess(session.profile, "tareas")} />;
}
