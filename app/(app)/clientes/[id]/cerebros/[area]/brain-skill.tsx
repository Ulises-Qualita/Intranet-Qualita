"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ActionButton } from "@/components/actions";
import { Icon } from "@/components/icons";
import { Pill } from "@/components/ui";
import { type BrainSkill, MIN_SKILL_CRITERIA } from "@/lib/brain-skills-shared";
import { makeZip } from "@/lib/zip";

// La skill descargable de un cerebro de área: Claude la arma con todos los
// criterios guardados (lib/brain-skills.ts) y se descarga en un .zip con la
// carpeta y su SKILL.md, listo para subir a Claude o copiar a .claude/skills.
// Cada vez que se genera queda una versión nueva; se muestra la última y se avisa
// si hay criterios nuevos desde entonces.

const when = (iso: string) =>
  new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function BrainSkillCard({
  area,
  areaName,
  skill,
  keys,
  missing,
}: {
  area: string;
  areaName: string;
  skill: BrainSkill | null;
  // Huellas de los criterios que tiene hoy el cerebro (criterionKey).
  keys: string[];
  missing: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState(false);
  const criteria = keys.length;
  // Qué cambió en el cerebro desde la versión vigente: criterios nuevos y borrados
  // (editar uno cuenta como los dos).
  const before = new Set(skill?.criteriaKeys ?? []);
  const now = new Set(keys);
  const added = skill ? [...now].filter((k) => !before.has(k)).length : 0;
  const removed = skill ? [...before].filter((k) => !now.has(k)).length : 0;
  const changes = [
    added && `${added} ${added === 1 ? "criterio nuevo" : "criterios nuevos"}`,
    removed && `${removed} ${removed === 1 ? "criterio borrado" : "criterios borrados"}`,
  ].filter(Boolean);
  const enough = criteria >= MIN_SKILL_CRITERIA;

  async function generate() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/cerebros/skill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ area }),
    }).catch(() => null);
    const json = (await res?.json().catch(() => null)) as { skill?: BrainSkill; error?: string } | null;
    setBusy(false);
    if (!json?.skill) return setError(json?.error ?? "No se pudo generar la skill.");
    // Ruta /api: refrescar para no ver la versión vieja (staleTimes).
    router.refresh();
  }

  return (
    <div className="card brain-next-card brain-skill">
      <span className="brain-next-ico on">
        <Icon name="sparkles" size={18} />
      </span>
      <div className="brain-skill-body">
        <h3>
          Skill de {areaName}
          {skill && <Pill variant="activo">v{skill.version}</Pill>}
        </h3>
        {missing ? (
          <p>Falta correr docs/sql/2026-11-26-cerebros-skills.sql en Supabase para guardar las skills.</p>
        ) : busy ? (
          <p className="brain-skill-working">
            <span className="brain-skill-dot" aria-hidden />
            Claude está escribiendo la skill con {criteria} criterios… tarda un minuto.
          </p>
        ) : skill ? (
          <>
            <p>
              Generada el {when(skill.createdAt)} con {skill.criteriaCount} criterios de {skill.meetingsCount}{" "}
              {skill.meetingsCount === 1 ? "reunión" : "reuniones"}.
            </p>
            {changes.length > 0 && (
              <p className="brain-skill-new">
                <Icon name="refresh" size={13} strokeWidth={2.2} />
                <span>
                  Desde esta versión: {changes.join(" y ")}. Generala de nuevo para actualizarla
                  {removed > 0 ? " y que deje de usar los borrados" : ""}.
                </span>
              </p>
            )}
          </>
        ) : enough ? (
          <p>Claude arma una skill con los {criteria} criterios del cerebro, para que trabaje con el criterio de Qualita en {areaName.toLowerCase()}.</p>
        ) : (
          <p>
            Hacen falta al menos {MIN_SKILL_CRITERIA} criterios para armarla (hay {criteria}). Cargá reuniones en “Cargar información”.
          </p>
        )}
        {error && <p className="form-error">{error}</p>}
        {!missing && (
          <div className="brain-skill-actions">
            {skill && (
              <>
                <ActionButton icon="download" disabled={busy} onClick={() => download(new Blob([skill.content], { type: "text/markdown" }), "SKILL.md")}>
                  Descargar .md
                </ActionButton>
                <ActionButton icon="eye" disabled={busy} onClick={() => setViewing(true)}>
                  Ver
                </ActionButton>
              </>
            )}
            {enough && (
              <ActionButton icon={skill ? "refresh" : "sparkles"} disabled={busy} onClick={generate}>
                {busy ? "Generando…" : skill ? "Generar de nuevo" : "Generar skill"}
              </ActionButton>
            )}
          </div>
        )}
      </div>
      {viewing && skill && <SkillPreview skill={skill} onClose={() => setViewing(false)} />}
    </div>
  );
}

// El SKILL.md tal cual, con cómo instalarlo y, por si hace falta, el .zip con su carpeta.
function SkillPreview({ skill, onClose }: { skill: BrainSkill; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} className="modal" aria-labelledby="skill-preview-title" onClose={onClose}>
      <div className="modal-card metrics-modal brain-skill-modal">
        <h2 id="skill-preview-title">
          {skill.name} <span>v{skill.version}</span>
        </h2>
        <p>
          Para usarla en Claude Code, guardá el <b>SKILL.md</b> en una carpeta <code>{skill.name}</code> dentro de <code>~/.claude/skills/</code> (o
          de <code>.claude/skills/</code> del proyecto). En Claude (Configuración → Capacidades → Skills) se sube el <b>.zip</b>, que ya trae
          esa carpeta.
        </p>
        <pre className="brain-skill-md">{skill.content}</pre>
        <div className="modal-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => download(makeZip([{ path: `${skill.name}/SKILL.md`, content: skill.content }]), `${skill.name}.zip`)}
          >
            Descargar .zip
          </button>
          <button type="button" className="btn-secondary btn-primary" onClick={() => ref.current?.close()}>
            Cerrar
          </button>
        </div>
      </div>
    </dialog>
  );
}
