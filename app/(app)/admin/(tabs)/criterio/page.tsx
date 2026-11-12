import { Card, EmptyState, NoAccess } from "@/components/ui";
import { getAdCriteria } from "@/lib/ad-criteria";
import { CRITERIA_PLATFORMS } from "@/lib/ad-criteria-shared";
import { getAreaSession } from "@/lib/auth";
import { getTeam } from "@/lib/data";
import { featureEnabled } from "@/lib/features";
import { CriteriaAdmin } from "../../criteria-admin";

// Criterio de pauta: textos y archivos que Claude tiene en cuenta en "Analizar
// plataforma", uno por plataforma. Lo ve el área admin; lo cambia un rol admin.
export default async function AdminCriterioPage() {
  const session = await getAreaSession("admin");
  if (!session) return <NoAccess />;

  const [criteria, team, analysisOn] = await Promise.all([getAdCriteria(), getTeam(), featureEnabled("platformAnalysis")]);

  if (criteria === null) {
    return (
      <section className="view">
        <Card title="Criterio de pauta">
          <EmptyState label="Falta la base">
            Para cargar el criterio hay que correr <b>docs/sql/2026-11-12-criterio-pauta.sql</b> en Supabase.
          </EmptyState>
        </Card>
      </section>
    );
  }

  const names = Object.fromEntries(team.map((m) => [m.id, m.name.split(" ")[0]]));

  return (
    <section className="view">
      <p className="hint-text mb-4">
        Lo que cargues acá lo recibe Claude cada vez que analiza una cuenta de esa plataforma (botón <b>Analizar plataforma</b> en las
        solapas META y GADS), junto con los datos de la cuenta: es la forma de trabajar de Qualita. Podés escribir el criterio o subir
        PDF, Word, textos e imágenes. Lo que esté pausado no se manda.
        {!analysisOn && " El análisis de plataforma está desactivado en Usuarios y accesos → Funciones en prueba."}
      </p>
      <div className="grid g2 crit-grid">
        {CRITERIA_PLATFORMS.map((p) => (
          <CriteriaAdmin
            key={p.id}
            platform={p.id}
            label={p.label}
            items={criteria.filter((c) => c.platform === p.id)}
            names={names}
            canEdit={session.profile?.role === "admin"}
          />
        ))}
      </div>
    </section>
  );
}
