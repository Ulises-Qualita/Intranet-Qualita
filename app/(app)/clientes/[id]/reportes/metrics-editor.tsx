"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { openPicker } from "@/components/custom-range";
import { Icon } from "@/components/icons";
import type {
  MetricsClarity,
  MetricsCrm,
  MetricsPauta,
  MetricsSales,
  Num,
  ReportMetrics,
} from "@/lib/report/metrics";

// Los números de un reporte para revisarlos o corregirlos: los que Claude sacó
// de un reporte cargado a mano, o los guardados de cualquier reporte. Son los que
// usa un reporte comparativo. Todas las secciones están siempre armadas; las
// vacías se descartan al guardar (parseMetrics).

type Form = {
  pauta: MetricsPauta;
  campaigns: ReportMetrics["campaigns"];
  crm: MetricsCrm;
  sales: MetricsSales;
  clarity: MetricsClarity;
};

type Field<K extends string> = { key: K; label: string };

const PAUTA: Field<keyof MetricsPauta>[] = [
  { key: "spend", label: "Inversión total ($)" },
  { key: "metaSpend", label: "Inversión Meta ($)" },
  { key: "gadsSpend", label: "Inversión Google ($)" },
  { key: "leads", label: "Leads" },
  { key: "metaLeads", label: "Leads Meta" },
  { key: "gadsLeads", label: "Leads Google" },
  { key: "cpl", label: "CPL ($)" },
  { key: "metaCpl", label: "CPL Meta ($)" },
  { key: "gadsCpl", label: "CPL Google ($)" },
  { key: "impressions", label: "Impresiones" },
  { key: "clicks", label: "Clics" },
  { key: "ctr", label: "CTR (%)" },
  { key: "cpm", label: "CPM ($)" },
];
type CrmNumbers = Exclude<keyof MetricsCrm, "sources" | "sellers">;
const CRM: Field<CrmNumbers>[] = [
  { key: "opportunities", label: "Oportunidades" },
  { key: "open", label: "Abiertas" },
  { key: "lost", label: "Perdidas" },
  { key: "won", label: "Ventas" },
  { key: "firstHalf", label: "1ª mitad del período" },
  { key: "lastHalf", label: "2ª mitad del período" },
  { key: "responseMedianHours", label: "Mediana de respuesta (h)" },
  { key: "contacted24Pct", label: "Contactados en 24 h (%)" },
  { key: "over3Days", label: "Tardaron +3 días" },
];
type SalesNumbers = Exclude<keyof MetricsSales, "bySource">;
const SALES: Field<SalesNumbers>[] = [
  { key: "billed", label: "Facturación ($)" },
  { key: "won", label: "Ventas" },
  { key: "withTicket", label: "Ventas con ticket" },
  { key: "ticketAvg", label: "Ticket promedio ($)" },
  { key: "usdBilled", label: "Facturación (U$D)" },
];
type ClarityNumbers = Exclude<keyof MetricsClarity, "sources">;
const CLARITY: Field<ClarityNumbers>[] = [
  { key: "users", label: "Usuarios" },
  { key: "sessions", label: "Sesiones" },
  { key: "sessionsPerDay", label: "Sesiones por día" },
  { key: "pagesPerSession", label: "Páginas por sesión" },
  { key: "activeTime", label: "Tiempo activo (s)" },
  { key: "scroll", label: "Scroll (%)" },
  { key: "rageShare", label: "Clics de frustración (%)" },
  { key: "mobileShare", label: "Mobile (%)" },
];

const blank = <K extends string>(fields: Field<K>[]) => Object.fromEntries(fields.map((f) => [f.key, null])) as Record<K, Num>;

function toForm(m: ReportMetrics | null): Form {
  return {
    pauta: { ...blank(PAUTA), ...m?.pauta },
    campaigns: m?.campaigns ?? [],
    crm: { ...blank(CRM), sources: [], sellers: [], ...m?.crm },
    sales: { ...blank(SALES), bySource: [], ...m?.sales },
    clarity: { ...blank(CLARITY), sources: [], ...m?.clarity },
  };
}

const toNum = (v: string): Num => (v.trim() === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

function NumberInput({ label, value, onChange }: { label: string; value: Num; onChange: (v: Num) => void }) {
  return (
    <label className="metrics-field">
      <span>{label}</span>
      <input type="number" step="any" value={value ?? ""} onChange={(e) => onChange(toNum(e.target.value))} placeholder="—" />
    </label>
  );
}

function Numbers<K extends string>({
  fields,
  values,
  onChange,
}: {
  fields: Field<K>[];
  values: Record<K, Num>;
  onChange: (key: K, value: Num) => void;
}) {
  return (
    <div className="metrics-grid">
      {fields.map((f) => (
        <NumberInput key={f.key} label={f.label} value={values[f.key]} onChange={(v) => onChange(f.key, v)} />
      ))}
    </div>
  );
}

// Filas con nombre y números (campañas, canales, vendedores, origen del tráfico).
type RowColumn = { key: string; label: string };
function Rows<T extends { name: string }>({
  title,
  rows,
  columns,
  empty,
  onChange,
  extra,
}: {
  title: string;
  rows: T[];
  columns: RowColumn[];
  empty: T;
  onChange: (rows: T[]) => void;
  extra?: (row: T, set: (row: T) => void) => React.ReactNode;
}) {
  const set = (i: number, row: T) => onChange(rows.map((r, j) => (j === i ? row : r)));
  return (
    <div className="metrics-rows">
      <div className="metrics-rows-head">
        <b>{title}</b>
        <button type="button" className="report-act" onClick={() => onChange([...rows, { ...empty }])}>
          <Icon name="plus" size={14} />
          <span>Agregar</span>
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="metrics-empty">Sin filas.</p>
      ) : (
        <div className="table-wrap">
          <table className="ctable metrics-table">
            <thead>
              <tr>
                <th>Nombre</th>
                {extra && <th>Plataforma</th>}
                {columns.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  <td>
                    <input value={row.name} onChange={(e) => set(i, { ...row, name: e.target.value })} aria-label="Nombre" />
                  </td>
                  {extra && <td>{extra(row, (r) => set(i, r))}</td>}
                  {columns.map((c) => (
                    <td key={c.key}>
                      <input
                        type="number"
                        step="any"
                        value={(row as unknown as Record<string, Num>)[c.key] ?? ""}
                        onChange={(e) => set(i, { ...row, [c.key]: toNum(e.target.value) })}
                        aria-label={c.label}
                        placeholder="—"
                      />
                    </td>
                  ))}
                  <td>
                    <button
                      type="button"
                      className="report-act danger"
                      title="Quitar fila"
                      onClick={() => onChange(rows.filter((_, j) => j !== i))}
                    >
                      <Icon name="trash" size={14} />
                      <span>Quitar</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function MetricsEditor({
  title,
  lead,
  since: initialSince,
  until: initialUntil,
  metrics,
  periodEditable,
  saveLabel = "Guardar",
  onSave,
  onClose,
}: {
  title: string;
  lead: React.ReactNode;
  since: string;
  until: string;
  metrics: ReportMetrics | null;
  periodEditable: boolean;
  saveLabel?: string;
  onSave: (values: { since: string; until: string; metrics: ReportMetrics }) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState<Form>(() => toForm(metrics));
  const [since, setSince] = useState(initialSince);
  const [until, setUntil] = useState(initialUntil);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const close = () => {
    if (!pending) ref.current?.close();
  };
  const update = <S extends keyof Form>(section: S, value: Form[S]) => setForm((f) => ({ ...f, [section]: value }));

  const save = () =>
    startTransition(async () => {
      setError(null);
      const result = await onSave({ since, until, metrics: { version: 1, ...form } });
      if (!result.ok) return setError(result.error ?? "No se pudo guardar.");
      ref.current?.close();
    });

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="metrics-editor-title"
      onClose={onClose}
      onCancel={(e) => {
        if (pending) e.preventDefault();
      }}
    >
      <div className="modal-card metrics-modal">
        <h2 id="metrics-editor-title">{title}</h2>
        <p>{lead}</p>

        <div className="report-dates">
          <label>
            <span>Desde</span>
            <input
              type="date"
              value={since}
              max={until || undefined}
              onChange={(e) => setSince(e.target.value)}
              onClick={openPicker}
              disabled={!periodEditable}
              required
            />
          </label>
          <label>
            <span>Hasta</span>
            <input
              type="date"
              value={until}
              min={since || undefined}
              onChange={(e) => setUntil(e.target.value)}
              onClick={openPicker}
              disabled={!periodEditable}
              required
            />
          </label>
        </div>

        <details className="metrics-section" open>
          <summary>Pauta (Meta + Google Ads)</summary>
          <Numbers fields={PAUTA} values={form.pauta} onChange={(k, v) => update("pauta", { ...form.pauta, [k]: v })} />
          <Rows
            title="Leads por campaña"
            rows={form.campaigns}
            empty={{ name: "", platform: "meta", spend: null, leads: null, cpl: null, ctr: null }}
            columns={[
              { key: "spend", label: "Inversión" },
              { key: "leads", label: "Leads" },
              { key: "cpl", label: "CPL" },
              { key: "ctr", label: "CTR (%)" },
            ]}
            onChange={(rows) => update("campaigns", rows)}
            extra={(row, set) => (
              <select value={row.platform} onChange={(e) => set({ ...row, platform: e.target.value === "google" ? "google" : "meta" })}>
                <option value="meta">Meta</option>
                <option value="google">Google</option>
              </select>
            )}
          />
        </details>

        <details className="metrics-section">
          <summary>Pipeline (CRM)</summary>
          <Numbers fields={CRM} values={form.crm} onChange={(k, v) => update("crm", { ...form.crm, [k]: v })} />
          <Rows
            title="Oportunidades por canal"
            rows={form.crm.sources}
            empty={{ name: "", leads: null }}
            columns={[{ key: "leads", label: "Oportunidades" }]}
            onChange={(rows) => update("crm", { ...form.crm, sources: rows })}
          />
          <Rows
            title="Vendedores"
            rows={form.crm.sellers}
            empty={{ name: "", won: null, leads: null, billed: null, ticketAvg: null }}
            columns={[
              { key: "won", label: "Ventas" },
              { key: "leads", label: "Leads" },
              { key: "billed", label: "Facturado" },
              { key: "ticketAvg", label: "Ticket prom." },
            ]}
            onChange={(rows) => update("crm", { ...form.crm, sellers: rows })}
          />
        </details>

        <details className="metrics-section">
          <summary>Ventas y facturación</summary>
          <Numbers fields={SALES} values={form.sales} onChange={(k, v) => update("sales", { ...form.sales, [k]: v })} />
          <Rows
            title="Ventas por origen"
            rows={form.sales.bySource}
            empty={{ name: "", sales: null }}
            columns={[{ key: "sales", label: "Ventas" }]}
            onChange={(rows) => update("sales", { ...form.sales, bySource: rows })}
          />
        </details>

        <details className="metrics-section">
          <summary>Sitio web (Clarity)</summary>
          <Numbers fields={CLARITY} values={form.clarity} onChange={(k, v) => update("clarity", { ...form.clarity, [k]: v })} />
          <Rows
            title="Origen del tráfico"
            rows={form.clarity.sources}
            empty={{ name: "", share: null }}
            columns={[{ key: "share", label: "% del tráfico" }]}
            onChange={(rows) => update("clarity", { ...form.clarity, sources: rows })}
          />
        </details>

        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={close} disabled={pending}>
            Cancelar
          </button>
          <button type="button" className="btn-secondary btn-primary" onClick={save} disabled={pending || !since || !until}>
            {pending ? "Guardando…" : saveLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
