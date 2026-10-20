"use client";

import { useEffect, useRef, useState } from "react";

export type SourceRow = { name: string; detail: string; value: string };

const COLLAPSED = 3;

function Rows({ rows }: { rows: SourceRow[] }) {
  return (
    <div className="source-list">
      {rows.map((s) => (
        <div key={s.name} className="lead-row">
          <div className="info">
            <b>{s.name}</b>
            <span>{s.detail}</span>
          </div>
          <span className="amount">{s.value}</span>
        </div>
      ))}
    </div>
  );
}

// Orígenes de las oportunidades o de las ventas: los primeros 3 en la tarjeta y
// la lista entera en un modal con "Ver más", así la tarjeta (y el embudo de al
// lado, que comparte la fila) no cambian de alto. Las filas llegan ya
// formateadas desde CrmView (server).
export function SourceList({ title, hint, rows }: { title: string; hint: string; rows: SourceRow[] }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Rows rows={rows.slice(0, COLLAPSED)} />
      {rows.length > COLLAPSED && (
        <button type="button" className="link-connect" onClick={() => setOpen(true)} aria-haspopup="dialog">
          Ver más ({rows.length - COLLAPSED})
        </button>
      )}
      {open && <SourceDialog title={title} hint={hint} rows={rows} onClose={() => setOpen(false)} />}
    </>
  );
}

function SourceDialog({ title, hint, rows, onClose }: { title: string; hint: string; rows: SourceRow[]; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => ref.current?.showModal(), []);
  const close = () => ref.current?.close();

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="source-dialog-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal-card modal-form source-dialog">
        <div className="modal-head">
          <div>
            <h2 id="source-dialog-title">{title}</h2>
            <span className="source-dialog-hint">{hint}</span>
          </div>
          <button type="button" className="modal-close" onClick={close} aria-label="Cerrar">
            ×
          </button>
        </div>
        <Rows rows={rows} />
      </div>
    </dialog>
  );
}
