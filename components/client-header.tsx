import type { Client } from "@/lib/data";
import { ClientAvatar } from "./client-avatar";
import { Icon } from "./icons";
import { ThemeToggle } from "./theme-toggle";

// La web cargada puede venir sin protocolo ("cliente.com").
const websiteHref = (website: string) => (/^https?:\/\//i.test(website) ? website : `https://${website}`);

// Encabezado del panel de un cliente (equipo): logo, nombre y, abajo,
// la web y el rubro. Reemplaza al Topbar en clientes/[id]/layout.tsx; las solapas
// van justo debajo.
export function ClientHeader({ client }: { client: Client }) {
  return (
    <div className="topbar client-header">
      <ClientAvatar client={client} />
      <div className="ch-text">
        <h1>{client.name}</h1>
        {(client.website || client.sector) && (
          <div className="ch-meta">
            {client.website && client.domain && (
              <a className="ch-web" href={websiteHref(client.website)} target="_blank" rel="noreferrer">
                <Icon name="globe" size={14} strokeWidth={1.9} />
                <span>{client.domain}</span>
                <Icon name="arrow-out" size={13} strokeWidth={2} className="ch-web-arrow" />
              </a>
            )}
            {client.sector && <span className="ch-sector">{client.sector}</span>}
          </div>
        )}
      </div>
      <div className="spacer" />
      <ThemeToggle />
    </div>
  );
}
