"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { SeRankingSite } from "@/lib/seranking";
import { connectSeRankingSite, setIntegration } from "../../../actions";

// Lista de proyectos de la cuenta de SE Ranking del estudio, para elegir el del cliente.
export function SitePicker({
  clientId,
  clientSlug,
  sites,
  currentSiteId,
}: {
  clientId: string;
  clientSlug: string;
  sites: SeRankingSite[];
  currentSiteId: string | null;
}) {
  const router = useRouter();
  const [siteId, setSiteId] = useState(currentSiteId ?? "");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const term = query.trim().toLowerCase();
  const shown = term ? sites.filter((s) => `${s.title} ${s.url}`.toLowerCase().includes(term)) : sites;

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await connectSeRankingSite(clientId, siteId);
      if (result.ok) router.push(`/clientes/${clientSlug}/seo`);
      else setError(result.error);
    });
  }

  return (
    <form
      className="stack-form"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      {sites.length > 8 && (
        <label>
          <span>Buscar</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nombre o dominio del proyecto"
            autoComplete="off"
            disabled={pending}
          />
        </label>
      )}

      <fieldset className="account-list" disabled={pending}>
        <legend>Proyecto</legend>
        {shown.length === 0 ? (
          <p className="muted">Ningún proyecto coincide con la búsqueda.</p>
        ) : (
          shown.map((s) => (
            <label key={s.id} className={`account-opt${siteId === s.id ? " on" : ""}`}>
              <input type="radio" name="site" value={s.id} checked={siteId === s.id} onChange={() => setSiteId(s.id)} />
              <span className="account-txt">
                <b>{s.title}</b>
                <span>
                  {[s.url, s.keywords !== null ? `${s.keywords} keywords` : null, s.active ? null : "pausado"]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
            </label>
          ))
        )}
      </fieldset>

      {error && <p className="form-error">{error}</p>}

      <div className="form-actions">
        <button type="submit" className="connect-btn" disabled={pending || !siteId}>
          {pending ? "Vinculando…" : "Vincular este proyecto"}
        </button>
      </div>
    </form>
  );
}

export function DisconnectSeRankingButton({ clientId }: { clientId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <button
        type="button"
        className="link-danger"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await setIntegration(clientId, "seranking", { connected: false });
            if (!result.ok) setError(result.error);
          })
        }
      >
        {pending ? "Desvinculando…" : "Desvincular proyecto"}
      </button>
      {error && <p className="form-error">{error}</p>}
    </>
  );
}
