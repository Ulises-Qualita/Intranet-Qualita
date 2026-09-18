"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { NotionPageRef } from "@/lib/notion";
import { connectNotionProject } from "../../../actions";

export function ProjectPicker({
  clientId,
  clientSlug,
  projects,
  currentProjectId,
}: {
  clientId: string;
  clientSlug: string;
  projects: NotionPageRef[];
  currentProjectId: string | null;
}) {
  const router = useRouter();
  const [projectId, setProjectId] = useState(currentProjectId ?? "");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const term = query.trim().toLowerCase();
  const shown = term ? projects.filter((p) => p.title.toLowerCase().includes(term)) : projects;

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await connectNotionProject(clientId, projectId);
      if (result.ok) router.push(`/clientes/${clientSlug}/tareas`);
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
      {/* Con muchos proyectos, la lista sola no alcanza. */}
      {projects.length > 8 && (
        <label>
          <span>Buscar</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nombre del proyecto"
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
          shown.map((p) => (
            <label key={p.id} className={`account-opt${projectId === p.id ? " on" : ""}`}>
              <input
                type="radio"
                name="project"
                value={p.id}
                checked={projectId === p.id}
                onChange={() => setProjectId(p.id)}
              />
              <span className="account-txt">
                <b>{p.title}</b>
              </span>
            </label>
          ))
        )}
      </fieldset>

      {error && <p className="form-error">{error}</p>}

      <div className="form-actions">
        <button type="submit" className="connect-btn" disabled={pending || !projectId}>
          {pending ? "Vinculando…" : "Vincular este proyecto"}
        </button>
      </div>
    </form>
  );
}
