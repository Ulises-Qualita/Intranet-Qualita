"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { GscSite } from "@/lib/search-console";
import { connectSearchConsoleSite, setIntegration } from "../../../actions";

const PERMISSIONS: Record<string, string> = {
  siteOwner: "propietario",
  siteFullUser: "usuario completo",
  siteRestrictedUser: "usuario restringido",
};

// Propiedades de la cuenta de Search Console del estudio, para elegir la del cliente.
export function SitePicker({
  clientId,
  clientSlug,
  sites,
  currentSite,
  suggested,
}: {
  clientId: string;
  clientSlug: string;
  sites: GscSite[];
  currentSite: string | null;
  suggested: string | null;
}) {
  const router = useRouter();
  const [siteUrl, setSiteUrl] = useState(currentSite ?? "");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const term = query.trim().toLowerCase();
  const ordered = suggested ? [...sites].sort((a, b) => Number(b.siteUrl === suggested) - Number(a.siteUrl === suggested)) : sites;
  const shown = term ? ordered.filter((s) => s.siteUrl.toLowerCase().includes(term)) : ordered;

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await connectSearchConsoleSite(clientId, siteUrl);
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
            placeholder="Dominio de la propiedad"
            autoComplete="off"
            disabled={pending}
          />
        </label>
      )}

      <fieldset className="account-list" disabled={pending}>
        <legend>Propiedad</legend>
        {shown.length === 0 ? (
          <p className="muted">Ninguna propiedad coincide con la búsqueda.</p>
        ) : (
          shown.map((s) => (
            <label key={s.siteUrl} className={`account-opt${siteUrl === s.siteUrl ? " on" : ""}`}>
              <input
                type="radio"
                name="site"
                value={s.siteUrl}
                checked={siteUrl === s.siteUrl}
                onChange={() => setSiteUrl(s.siteUrl)}
              />
              <span className="account-txt">
                <b>{s.label}</b>
                <span>
                  {[
                    s.kind === "domain" ? "Propiedad de dominio" : "Prefijo de URL",
                    PERMISSIONS[s.permission] ?? null,
                    s.siteUrl === suggested ? "coincide con la web del cliente" : null,
                  ]
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
        <button type="submit" className="connect-btn" disabled={pending || !siteUrl}>
          {pending ? "Vinculando…" : "Vincular esta propiedad"}
        </button>
      </div>
    </form>
  );
}

export function DisconnectSearchConsoleButton({ clientId }: { clientId: string }) {
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
            const result = await setIntegration(clientId, "search_console", { connected: false });
            if (!result.ok) setError(result.error);
          })
        }
      >
        {pending ? "Desvinculando…" : "Desvincular propiedad"}
      </button>
      {error && <p className="form-error">{error}</p>}
    </>
  );
}
