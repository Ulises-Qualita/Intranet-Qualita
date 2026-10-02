import { notFound } from "next/navigation";
import { Card, EmptyState, NoAccess } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { getClient } from "@/lib/data";

// Google Ads, solo para el equipo. Todavía sin datos: la conexión con la cuenta
// de servicio ya funciona (env GOOGLE_ADS_*), pero el developer token está en
// modo de prueba y Google rechaza las consultas a cuentas reales hasta aprobar
// el acceso (CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION).
export default async function ClienteGadsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Misma área que META: es la publicidad del cliente.
  const [session, client] = await Promise.all([getAreaSession("meta"), getClient(id)]);
  if (!session) return <NoAccess />;
  if (!client) notFound();

  return (
    <section className="view">
      <Card title="Google Ads">
        <EmptyState label="Pendiente">Esperando la aprobación de Google Ads para acceder a la API.</EmptyState>
      </Card>
    </section>
  );
}
