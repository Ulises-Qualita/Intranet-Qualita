import type { Client } from "@/lib/data";

// Logo subido del cliente; sin logo, iniciales sobre el degradado.
export function ClientAvatar({ client }: { client: Pick<Client, "name" | "initials" | "logoUrl"> }) {
  if (!client.logoUrl) {
    return (
      <div className="av" style={{ background: "var(--grad)" }}>
        {client.initials}
      </div>
    );
  }

  return (
    <div className="av logo">
      {/* eslint-disable-next-line @next/next/no-img-element -- logo en Supabase Storage */}
      <img src={client.logoUrl} alt={client.name} />
    </div>
  );
}
