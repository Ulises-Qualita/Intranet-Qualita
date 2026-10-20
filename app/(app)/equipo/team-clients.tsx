"use client";

import Link from "next/link";
import { useState } from "react";
import { ClientAvatar } from "@/components/client-avatar";
import type { Client } from "@/lib/data";

// Clientes que se ven de entrada; el resto, detrás de "+N más".
const SHOWN = 8;

// Los clientes de una persona como chips que se acomodan en filas (uno por
// renglón estiraba mucho la tarjeta). Con muchos, "+N más" despliega el resto.
export function TeamClients({ clients }: { clients: Pick<Client, "id" | "slug" | "name" | "initials" | "logoUrl">[] }) {
  const [all, setAll] = useState(false);
  const extra = clients.length - SHOWN;
  const shown = all || extra <= 0 ? clients : clients.slice(0, SHOWN);

  return (
    <ul className="team-clients">
      {shown.map((c) => (
        <li key={c.id}>
          <Link href={`/clientes/${c.slug}`} title={c.name}>
            <ClientAvatar client={c} />
            <span>{c.name}</span>
          </Link>
        </li>
      ))}
      {extra > 0 && (
        <li>
          <button type="button" className="team-more" aria-expanded={all} onClick={() => setAll(!all)}>
            {all ? "Ver menos" : `+${extra} más`}
          </button>
        </li>
      )}
    </ul>
  );
}
