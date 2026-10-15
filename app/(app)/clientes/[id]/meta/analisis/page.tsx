import { notFound } from "next/navigation";
import { AnalysisView } from "@/components/analysis/analysis-view";
import { NoAccess } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { getClient } from "@/lib/data";

// Recomendaciones de "Analizar plataforma" para Meta (solo equipo, área META). Sin
// Topbar: el encabezado del cliente lo dibuja clientes/[id]/layout.tsx.
export default async function MetaAnalisisPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ id?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const [session, c] = await Promise.all([getAreaSession("meta"), getClient(id)]);
  if (!session) return <NoAccess />;
  if (!c) notFound();

  return <AnalysisView clientId={c.id} platform="meta" base={`/clientes/${c.slug}/meta/analisis`} selected={query.id} />;
}
