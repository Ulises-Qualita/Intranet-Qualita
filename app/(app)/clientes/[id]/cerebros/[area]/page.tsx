import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icons";
import { NoAccess, Pill } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { getBrainMeetings } from "@/lib/brain-meetings";
import { getBrainSkill } from "@/lib/brain-skills";
import { criterionKey } from "@/lib/brain-skills-shared";
import { BRAIN_AREAS, brainArea } from "@/lib/brains";
import { getClient } from "@/lib/data";
import { BrainKnowledge } from "./brain-knowledge";
import { BrainSkillCard } from "./brain-skill";
import { BrainUploader } from "./brain-uploader";

// Un cerebro de área (Redes, SEO…): lo que sabe, cargar más información, y lo que
// viene (carga automática de reuniones), y la skill descargable del área. Las reuniones ya se guardan
// (lib/brain-meetings.ts); documentos y notas siguen siendo solo interfaz.
export default async function BrainAreaPage({ params }: { params: Promise<{ id: string; area: string }> }) {
  const { id, area: key } = await params;
  const [session, client] = await Promise.all([getAreaSession("clientes"), getClient(id)]);
  if (!session) return <NoAccess />;
  const area = brainArea(key);
  if (!client?.internal || !area) notFound();

  const [loaded, skill] = await Promise.all([getBrainMeetings(area.key), getBrainSkill(area.key)]);
  const meetings = loaded ?? [];
  // Archivos todavía no se guardan (brain-uploader.tsx): cuentan 0 reales hasta que se conecten.
  const files = 0;
  const base = `/clientes/${client.slug}/cerebros`;
  const others = BRAIN_AREAS.filter((a) => a.key !== area.key);

  return (
    <section className="view brain-area">
      <nav className="brain-crumbs" aria-label="Cerebros">
        <Link href={base} className="brain-back">
          <Icon name="chevron" size={15} />
          Cerebros
        </Link>
        <div className="brain-switch">
          {others.map((a) => (
            <Link key={a.key} href={`${base}/${a.key}`}>
              {a.name}
            </Link>
          ))}
        </div>
      </nav>

      <header className="brain-hero">
        <span className="brain-hero-ico">
          <Icon name={area.icon} size={26} />
        </span>
        <div>
          <span className="brain-hero-kicker">Cerebro</span>
          <h2>{area.name}</h2>
          <p>{area.description}</p>
          <div className="brain-feeds">
            {area.feeds.map((f) => (
              <span key={f}>{f}</span>
            ))}
          </div>
        </div>
        <dl className="brain-hero-stats">
          <div>
            <dt>Fuentes</dt>
            <dd>{meetings.length + files}</dd>
          </div>
          <div>
            <dt>Reuniones</dt>
            <dd>{meetings.length}</dd>
          </div>
          <div>
            <dt>Archivos</dt>
            <dd>{files}</dd>
          </div>
        </dl>
      </header>

      <div className="brain-grid">
        <BrainKnowledge meetings={meetings} areaName={area.name} missing={loaded === null} />

        <BrainUploader area={area.key} areaName={area.name} />
      </div>

      <div className="brain-next">
        <div className="card brain-next-card">
          <span className="brain-next-ico">
            <Icon name="play" size={18} />
          </span>
          <div>
            <h3>
              Reuniones automáticas <Pill variant="pendiente">Próximamente</Pill>
            </h3>
            <p>Que las reuniones se carguen solas según su nombre o quiénes participan. Por ahora se cargan a mano desde “Reunión”.</p>
          </div>
        </div>
        <BrainSkillCard
          area={area.key}
          areaName={area.name}
          skill={skill ?? null}
          keys={meetings.flatMap((m) => m.insights.learnings.map(criterionKey))}
          missing={skill === undefined}
        />
      </div>
    </section>
  );
}
