import Link from "next/link";
import type { Client } from "@/lib/data";
import { IntegrationDialog } from "./integration-dialog";
import { Icon, type IconName } from "./icons";

export function Kpi({
  label,
  icon,
  value,
  sub,
  hero,
}: {
  label: string;
  icon: IconName;
  value: string | number;
  sub: string;
  hero?: boolean;
}) {
  return (
    <div className={`card kpi${hero ? " hero" : ""}`}>
      <div className="top">
        <span className="label">{label}</span>
        <span className="ico">
          <Icon name={icon} />
        </span>
      </div>
      <div className="val">{value}</div>
      <div className="delta flat" style={{ fontWeight: 500 }}>
        {sub}
      </div>
    </div>
  );
}

// KPI sin datos todavía: guion + motivo (pendiente o integración sin conectar).
export function KpiLocked({
  label,
  icon,
  note = "Pendiente",
  href,
}: {
  label: string;
  icon: IconName;
  note?: string;
  href?: string;
}) {
  return (
    <div className="card kpi locked">
      <div className="top">
        <span className="label">{label}</span>
        <span className="ico">
          <Icon name={icon} />
        </span>
      </div>
      <div className="val">—</div>
      {href ? (
        <Link className="link-connect" href={href}>
          {note}
        </Link>
      ) : (
        <div className="delta flat" style={{ fontWeight: 500 }}>
          {note}
        </div>
      )}
    </div>
  );
}

type ConnectKind = "meta" | "crm" | "notion" | "clarity";

const CONNECT_COPY: Record<ConnectKind, { icon: IconName; title: string; desc: string; cta: string }> = {
  notion: {
    icon: "check",
    title: "Conectá el proyecto de Notion",
    desc: "Elegí a qué proyecto de Notion corresponde este cliente para ver acá sus tickets, con estado, prioridad, responsable y vencimiento.",
    cta: "Elegir proyecto de Notion",
  },
  meta: {
    icon: "bolt",
    title: "Conectá la cuenta de Meta",
    desc: "Vinculá la cuenta de Meta Business de este cliente para traer las métricas de anuncios: gasto, CPL, leads y rendimiento por anuncio.",
    cta: "Conectar cuenta de Meta",
  },
  crm: {
    icon: "funnel",
    title: "Conectá el CRM",
    desc: "Vinculá el CRM de este cliente para ver el pipeline, las etapas, los leads y las conversaciones.",
    cta: "Conectar CRM",
  },
  clarity: {
    icon: "eye",
    title: "Conectá Microsoft Clarity",
    desc: "Vinculá el proyecto de Clarity del sitio de este cliente para ver sesiones, páginas más vistas y las señales de fricción: rage clicks, clics muertos y errores.",
    cta: "Conectar Clarity",
  },
};

export function ConnectState({ kind, client }: { kind: ConnectKind; client: Pick<Client, "id" | "slug" | "name" | "integrations"> }) {
  const c = CONNECT_COPY[kind];
  return (
    <div className="card connect-state">
      <div className="cs-ico">
        <Icon name={c.icon} />
      </div>
      <h3>{c.title}</h3>
      <p>{c.desc}</p>
      <IntegrationDialog
        clientId={client.id}
        clientSlug={client.slug}
        clientName={client.name}
        provider={kind}
        state={client.integrations[kind]}
        trigger="button"
        triggerLabel={c.cta}
      />
    </div>
  );
}

export function Card({
  title,
  hint,
  action,
  className = "",
  children,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`card pad-lg ${className}`}>
      <div className="card-h">
        <h3>{title}</h3>
        {action ?? (hint && <span className="hint">{hint}</span>)}
      </div>
      {children}
    </div>
  );
}

export function Pill({ variant, children }: { variant: string; children: React.ReactNode }) {
  return <span className={`pill ${variant}`}>{children}</span>;
}

export function EmptyState({ label = "Pendiente", children }: { label?: string; children: React.ReactNode }) {
  return (
    <div className="empty-state">
      <Pill variant="pendiente">{label}</Pill>
      <span>{children}</span>
    </div>
  );
}

export function NoAccess() {
  return (
    <section className="view">
      <div className="card connect-state">
        <div className="cs-ico">
          <Icon name="shield" />
        </div>
        <h3>Sin acceso a esta sección</h3>
        <p>Pedile a un administrador que te habilite el área desde Administración.</p>
      </div>
    </section>
  );
}
