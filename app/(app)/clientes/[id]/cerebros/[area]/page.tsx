import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icons";
import { EmptyState, NoAccess, Pill } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { BRAIN_AREAS, brainArea } from "@/lib/brains";
import { getClient } from "@/lib/data";
import { BrainUploader } from "./brain-uploader";

// Un cerebro de área (Redes, SEO…): lo que sabe, cargar más información, y lo que
// viene (reuniones y skills). Solo interfaz por ahora: no hay fuentes guardadas.
export default async function BrainAreaPage({ params }: { params: Promise<{ id: string; area: string }> }) {
  const { id, area: key } = await params;
  const [session, client] = await Promise.all([getAreaSession("clientes"), getClient(id)]);
  if (!session) return <NoAccess />;
  const area = brainArea(key);
  if (!client?.internal || !area) notFound();

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
            <dd>0</dd>
          </div>
          <div>
            <dt>Reuniones</dt>
            <dd>0</dd>
          </div>
          <div>
            <dt>Skills</dt>
            <dd>0</dd>
          </div>
        </dl>
      </header>

      <div className="brain-grid">
        <div className="card brain-knowledge">
          <div className="brain-upload-head">
            <h3>Lo que sabe</h3>
            <div className="brain-seg" aria-hidden>
              <span className="on">Todo</span>
              <span>Documentos</span>
              <span>Notas</span>
              <span>Reuniones</span>
            </div>
          </div>
          <EmptyState label="Vacío">
            Todavía no tiene información cargada. Sumá documentos o notas con el criterio de {area.name.toLowerCase()} para
            que empiece a aprender.
          </EmptyState>
        </div>

        <BrainUploader areaName={area.name.toLowerCase()} />
      </div>

      <div className="brain-next">
        <div className="card brain-next-card">
          <span className="brain-next-ico">
            <Icon name="play" size={18} />
          </span>
          <div>
            <h3>
              Reuniones <Pill variant="pendiente">Por definir</Pill>
            </h3>
            <p>Grabaciones de Meet o de una herramienta como Read.ai, transcriptas y sumadas al cerebro.</p>
          </div>
        </div>
        <div className="card brain-next-card">
          <span className="brain-next-ico">
            <Icon name="sparkles" size={18} />
          </span>
          <div>
            <h3>
              Skills <Pill variant="pendiente">Próximamente</Pill>
            </h3>
            <p>Con el contexto y el criterio que se cargue acá se van a generar las skills de {area.name.toLowerCase()}.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
