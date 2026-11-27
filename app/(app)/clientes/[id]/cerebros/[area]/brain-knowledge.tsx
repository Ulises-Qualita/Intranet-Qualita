"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ActionButton, ConfirmDialog } from "@/components/actions";
import { Icon } from "@/components/icons";
import { EmptyState } from "@/components/ui";
import { type BrainMeeting, type Learning, SOURCE_LABEL } from "@/lib/brain-meetings-shared";
import { deleteBrainMeeting } from "../actions";

// "Criterios y aprendizajes" de un cerebro de área: lo que junta de todas sus
// reuniones, en bullets (solo el título; al tocarlo se ve la regla, con la
// reunión de origen). La lista tiene alto fijo y scroll propio
// para que la tarjeta no se estire. "Reuniones" lista de dónde salió cada uno.

type View = "criterios" | "reuniones";

const day = (iso: string) =>
  new Date(`${iso}T12:00:00-03:00`).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" });

export function BrainKnowledge({ meetings, areaName, missing }: { meetings: BrainMeeting[]; areaName: string; missing: boolean }) {
  const [view, setView] = useState<View>("criterios");
  const [removing, setRemoving] = useState<BrainMeeting | null>(null);
  const router = useRouter();
  const criteria = meetings.flatMap((m) => m.insights.learnings.map((l, i) => ({ key: `${m.id}-${i}`, l, from: m })));

  return (
    <div className="card brain-knowledge">
      <div className="brain-upload-head">
        <h3>Criterios y aprendizajes</h3>
        {meetings.length > 0 && (
          <div className="brain-seg" role="tablist" aria-label="Ver">
            <button type="button" role="tab" aria-selected={view === "criterios"} className={view === "criterios" ? "on" : ""} onClick={() => setView("criterios")}>
              Criterios <span className="brain-seg-n">{criteria.length}</span>
            </button>
            <button type="button" role="tab" aria-selected={view === "reuniones"} className={view === "reuniones" ? "on" : ""} onClick={() => setView("reuniones")}>
              Reuniones <span className="brain-seg-n">{meetings.length}</span>
            </button>
          </div>
        )}
      </div>

      {missing ? (
        <EmptyState label="Pendiente">Falta correr docs/sql/2026-11-26-cerebros-reuniones.sql en Supabase para guardar reuniones.</EmptyState>
      ) : !meetings.length ? (
        <EmptyState label="Vacío">
          Todavía no tiene criterios. Cargá una reunión y Claude saca los criterios y aprendizajes de {areaName}.
        </EmptyState>
      ) : view === "criterios" ? (
        <ul className="brain-bullets q-scroll">
          {criteria.map(({ key, l, from }) => (
            <CriterionItem key={key} l={l} meta={[from.title, from.metOn && day(from.metOn)].filter(Boolean).join(" · ")} />
          ))}
        </ul>
      ) : (
        <ul className="brain-items q-scroll">
          {meetings.map((m) => (
            <li key={m.id} className="brain-item">
              <span className="brain-item-ico">
                <Icon name="play" size={15} />
              </span>
              <div className="brain-item-title">
                <b>{m.title}</b>
                <span>
                  {[
                    m.metOn && day(m.metOn),
                    SOURCE_LABEL[m.source],
                    `${m.insights.learnings.length} ${m.insights.learnings.length === 1 ? "criterio" : "criterios"}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              <ActionButton icon="trash" danger onClick={() => setRemoving(m)}>
                Borrar
              </ActionButton>
            </li>
          ))}
        </ul>
      )}

      {removing && (
        <ConfirmDialog
          title="Borrar reunión"
          confirmLabel="Borrar"
          onConfirm={async () => {
            const r = await deleteBrainMeeting(removing.id);
            if (r.ok) router.refresh();
            return r;
          }}
          onClose={() => setRemoving(null)}
        >
          <b>{removing.title}</b> y sus {removing.insights.learnings.length} criterios dejan de ser parte del cerebro de {areaName}.
        </ConfirmDialog>
      )}
    </div>
  );
}

function CriterionItem({ l, meta }: { l: Learning; meta: string }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`brain-bullet${open ? " open" : ""}${l.title ? "" : " untitled"}`}>
      <span className="brain-bullet-dot" aria-hidden />
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {l.title && <b>{l.title}</b>}
        <span className="brain-bullet-detail">{l.detail}</span>
        <em>{meta}</em>
      </button>
    </li>
  );
}
