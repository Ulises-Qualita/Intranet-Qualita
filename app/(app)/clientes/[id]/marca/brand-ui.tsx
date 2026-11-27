"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ActionButton, ConfirmDialog } from "@/components/actions";
import { Icon } from "@/components/icons";
import {
  ASSET_KINDS,
  type AssetKind,
  BRAND_BUCKET,
  BRAND_PDF_MAX,
  BRAND_PDF_MAX_LABEL,
  type BrandApplication,
  type BrandData,
  type BrandStatus,
  type LogoSource,
  normalizeHex,
} from "@/lib/brand-shared";
import { createClient } from "@/lib/supabase/client";
import {
  brandAssetUploaded,
  brandPdfUploaded,
  createBrandUpload,
  deleteBrandApplication,
  deleteBrandAsset,
  deleteBrandBook,
  saveBrandData,
  setMainLogo,
} from "./actions";

// ---------- Copiar ----------

// Sin permiso de portapapeles devuelve false y no se muestra "Copiado".
async function copy(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

// Muestra de color: rol y nombre, y adentro del color cada código (HEX, RGB,
// CMYK, Pantone), que se copia al tocarlo.
export function Swatch({
  name,
  hex,
  role,
  codes,
  dark,
  big,
}: {
  name: string;
  hex: string;
  role: string | null;
  codes: { label: string; value: string }[];
  dark: boolean;
  big: boolean;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const flash = async (label: string, value: string) => {
    if (await copy(value)) {
      setCopied(label);
      setTimeout(() => setCopied(null), 1300);
    }
  };
  return (
    <div className={`bh-swatch bh-chip${dark ? " dark" : ""}${big ? " big" : ""}`} style={{ background: hex }}>
      <span className="bh-chip-txt">
        {role && <small>{role}</small>}
        <b>{name}</b>
      </span>
      <div className="bh-codes">
        {[{ label: "HEX", value: hex }, ...codes].map((c) => (
          <button key={c.label} type="button" onClick={() => flash(c.label, c.value)} title={`Copiar ${c.value}`} aria-label={`Copiar ${c.label} ${c.value} (${name})`}>
            <small>{c.label}</small>
            <span>{copied === c.label ? "Copiado" : c.value}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Texto que se copia (nombre de una fuente, la paleta entera), como link discreto.
export function CopyText({ value, children }: { value: string; children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="bh-link"
      onClick={async () => {
        if (await copy(value)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1300);
        }
      }}
    >
      <Icon name={copied ? "check" : "copy"} size={13} strokeWidth={2} />
      {copied ? "Copiado" : children}
    </button>
  );
}

// ---------- Subidas ----------

export async function uploadFile(clientId: string, target: "pdf" | AssetKind, file: File): Promise<string | null> {
  const signed = await createBrandUpload(clientId, target, { name: file.name, size: file.size });
  if (!signed.ok) return signed.error;
  const { error } = await createClient()
    .storage.from(BRAND_BUCKET)
    .uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type || "application/octet-stream" });
  if (error) return "No se pudo subir el archivo.";
  const saved =
    target === "pdf"
      ? await brandPdfUploaded(clientId, signed.path, file.name)
      : await brandAssetUploaded(clientId, target, signed.path, file.name, file.type);
  return saved.ok ? null : saved.error;
}

// Lee el manual y, si el cliente no tenía logos, los recorta del PDF y los guarda
// (onLogos avisa ese segundo paso para mostrarlo).
async function runExtraction(clientSlug: string, onLogos?: () => void): Promise<string | null> {
  const res = await fetch("/api/marca/extraer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client: clientSlug }),
  }).catch(() => null);
  const json = (await res?.json().catch(() => null)) as {
    ok?: boolean;
    error?: string;
    crop?: { clientId: string; pdfUrl: string; logos: LogoSource[] | null; applications: BrandApplication[] | null } | null;
  } | null;
  if (!json?.ok) return json?.error ?? "No se pudo leer el manual.";
  const crop = json.crop;
  if (!crop) return null;
  onLogos?.();
  // Logos y aplicaciones (piezas reales y ejemplos para redes) recortados del PDF.
  const { saveApplicationsFromPdf, saveLogosFromPdf } = await import("./logo-from-pdf");
  const errors = [
    crop.logos?.length ? await saveLogosFromPdf(crop.clientId, crop.pdfUrl, crop.logos) : null,
    crop.applications?.length ? await saveApplicationsFromPdf(crop.clientId, crop.pdfUrl, crop.applications) : null,
  ].filter(Boolean);
  return errors.length ? errors.join(" ") : null;
}

// Subir (o reemplazar) el PDF y leerlo con Claude de una.
export function PdfUploader({ clientId, clientSlug, hero }: { clientId: string; clientSlug: string; hero?: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"idle" | "subiendo" | "leyendo" | "logos">("idle");
  const [error, setError] = useState<string | null>(null);

  async function pick(file: File) {
    setError(null);
    if (!/\.pdf$/i.test(file.name)) return setError("El manual tiene que ser un PDF.");
    if (file.size > BRAND_PDF_MAX) return setError(`El PDF pasa los ${BRAND_PDF_MAX_LABEL}. Exportalo más liviano (imágenes comprimidas).`);
    setStep("subiendo");
    const uploadError = await uploadFile(clientId, "pdf", file);
    if (uploadError) {
      setStep("idle");
      return setError(uploadError);
    }
    router.refresh();
    setStep("leyendo");
    const readError = await runExtraction(clientSlug, () => {
      router.refresh();
      setStep("logos");
    });
    setStep("idle");
    if (readError) setError(readError);
    router.refresh();
  }

  const busy = step !== "idle";
  const label = step === "subiendo" ? "Subiendo el PDF…" : step === "leyendo"
        ? "Claude está leyendo el manual…"
        : step === "logos"
          ? "Recortando logos y aplicaciones del PDF…"
          : null;

  return (
    <div className={hero ? "brand-drop" : undefined}>
      {hero ? (
        <button type="button" className="brand-drop-btn" disabled={busy} onClick={() => input.current?.click()}>
          <span className="brand-drop-ico">
            <Icon name={busy ? "sparkles" : "upload"} size={22} />
          </span>
          <b>{label ?? "Subí el manual de marca"}</b>
          <span>{busy ? "Puede tardar un par de minutos. No cierres esta pestaña." : `PDF de hasta ${BRAND_PDF_MAX_LABEL}`}</span>
        </button>
      ) : (
        <ActionButton icon="upload" disabled={busy} onClick={() => input.current?.click()}>
          {label ?? "Reemplazar PDF"}
        </ActionButton>
      )}
      <input
        ref={input}
        type="file"
        accept=".pdf,application/pdf"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void pick(file);
          e.target.value = "";
        }}
      />
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

// Leer (o volver a leer) el PDF ya subido.
export function ExtractButton({ clientSlug, status }: { clientSlug: string; status: BrandStatus }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [cropping, setCropping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = busy || status === "extrayendo";
  return (
    <>
      <ActionButton
        icon="sparkles"
        disabled={running}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const readError = await runExtraction(clientSlug, () => {
            router.refresh();
            setCropping(true);
          });
          setBusy(false);
          setCropping(false);
          if (readError) setError(readError);
          router.refresh();
        }}
      >
        {cropping ? "Recortando logos…" : running ? "Leyendo…" : status === "listo" ? "Volver a leer" : "Leer con Claude"}
      </ActionButton>
      {error && <p className="form-error brand-inline-error">{error}</p>}
    </>
  );
}

export function AssetUploader({ clientId, kind, label }: { clientId: string; kind: AssetKind; label?: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const meta = ASSET_KINDS.find((k) => k.id === kind)!;

  async function pick(files: FileList) {
    setError(null);
    for (const file of Array.from(files)) {
      setUploading(file.name);
      const uploadError = await uploadFile(clientId, kind, file);
      if (uploadError) setError(`${file.name}: ${uploadError}`);
    }
    setUploading(null);
    router.refresh();
  }

  return (
    <div className="brand-uploader">
      <ActionButton icon="upload" disabled={!!uploading} onClick={() => input.current?.click()} title={meta.hint}>
        {uploading ? `Subiendo ${uploading}…` : (label ?? "Subir archivos")}
      </ActionButton>
      <input
        ref={input}
        type="file"
        accept={meta.accept || undefined}
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) void pick(e.target.files);
          e.target.value = "";
        }}
      />
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

// Saca una aplicación (imagen recortada del PDF) de la sección Aplicada.
export function DeleteApplicationButton({ clientId, index, name }: { clientId: string; index: number; name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ActionButton icon="trash" danger onClick={() => setOpen(true)}>
        Quitar
      </ActionButton>
      {open && (
        <ConfirmDialog
          title={`¿Quitar "${name}"?`}
          confirmLabel="Sí, quitar"
          pendingLabel="Quitando…"
          onConfirm={() => deleteBrandApplication(clientId, index)}
          onClose={() => setOpen(false)}
        >
          Se saca del manual en la intranet. Se puede volver a sacar del PDF.
        </ConfirmDialog>
      )}
    </>
  );
}

export function DeleteAssetButton({ clientId, id, name }: { clientId: string; id: string; name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ActionButton icon="trash" danger onClick={() => setOpen(true)}>
        Borrar
      </ActionButton>
      {open && (
        <ConfirmDialog
          title={`¿Borrar "${name}"?`}
          confirmLabel="Sí, borrar archivo"
          onConfirm={() => deleteBrandAsset(clientId, id)}
          onClose={() => setOpen(false)}
        >
          El archivo deja de estar disponible para descargar. <b>No se puede deshacer.</b>
        </ConfirmDialog>
      )}
    </>
  );
}

export function DeleteBookButton({ clientId }: { clientId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ActionButton icon="trash" danger onClick={() => setOpen(true)}>
        Borrar manual
      </ActionButton>
      {open && (
        <ConfirmDialog
          title="¿Borrar el manual de marca?"
          confirmLabel="Sí, borrar manual"
          onConfirm={() => deleteBrandBook(clientId)}
          onClose={() => setOpen(false)}
        >
          Se borran el PDF y todo lo que se leyó de él (colores, tipografías, logo, tono). Los logos, fuentes y recursos subidos aparte
          quedan. <b>No se puede deshacer.</b>
        </ConfirmDialog>
      )}
    </>
  );
}

// ---------- Editor ----------

const lines = (list: string[]) => list.join("\n");
const fromLines = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

type ColorRow = { name: string; hex: string; role: string; pantone: string; usage: string; rgb: string | null; cmyk: string | null };
type FontRow = { family: string; role: string; weights: string; usage: string };

export function EditBrandButton({ clientId, data }: { clientId: string; data: BrandData }) {
  const [n, setN] = useState(0);
  return (
    <>
      <ActionButton icon="pencil" onClick={() => setN(Date.now())}>
        Editar datos
      </ActionButton>
      {n > 0 && <BrandEditor key={n} clientId={clientId} data={data} onClose={() => setN(0)} />}
    </>
  );
}

function BrandEditor({ clientId, data, onClose }: { clientId: string; data: BrandData; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState(data.summary);
  const [colors, setColors] = useState<ColorRow[]>(
    data.colors.map((c) => ({
      name: c.name,
      hex: c.hex,
      role: c.role ?? "",
      pantone: c.pantone ?? "",
      usage: c.usage ?? "",
      rgb: c.rgb ?? null,
      cmyk: c.cmyk ?? null,
    })),
  );
  const [fonts, setFonts] = useState<FontRow[]>(
    data.fonts.map((f) => ({ family: f.family, role: f.role ?? "", weights: (f.weights ?? []).join(", "), usage: f.usage ?? "" })),
  );
  const [logoDescription, setLogoDescription] = useState(data.logo.description ?? "");
  const [logoRules, setLogoRules] = useState(lines(data.logo.rules));
  const [voice, setVoice] = useState(data.voice.description ?? "");
  const [keywords, setKeywords] = useState(data.voice.keywords.join(", "));
  const [dos, setDos] = useState(lines(data.voice.dos));
  const [donts, setDonts] = useState(lines(data.voice.donts));
  const [imagery, setImagery] = useState(lines(data.imagery));

  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const close = () => {
    if (!pending) ref.current?.close();
  };

  const setColor = (i: number, patch: Partial<ColorRow>) => setColors((list) => list.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const setFont = (i: number, patch: Partial<FontRow>) => setFonts((list) => list.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const bad = colors.find((c) => !normalizeHex(c.hex));
    if (bad) return setError(`Revisá el HEX de "${bad.name || "un color"}": tiene que ser como #B50CC5.`);
    if (fonts.some((f) => !f.family.trim())) return setError("Cada tipografía necesita el nombre de la familia.");
    const next: BrandData = {
      summary,
      colors: colors.map((c) => ({
        name: c.name.trim() || normalizeHex(c.hex)!,
        hex: normalizeHex(c.hex)!,
        role: c.role || null,
        pantone: c.pantone || null,
        usage: c.usage || null,
        // Si cambió el HEX, los códigos del manual ya no valen: se calculan al mostrar.
        rgb: c.rgb,
        cmyk: c.cmyk,
      })),
      fonts: fonts.map((f) => ({
        family: f.family.trim(),
        role: f.role || null,
        usage: f.usage || null,
        weights: f.weights
          .split(",")
          .map((w) => w.trim())
          .filter(Boolean),
      })),
      logo: { ...data.logo, description: logoDescription || null, rules: fromLines(logoRules) },
      voice: {
        description: voice || null,
        keywords: keywords
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean),
        dos: fromLines(dos),
        donts: fromLines(donts),
      },
      imagery: fromLines(imagery),
    };
    startTransition(async () => {
      setError(null);
      const result = await saveBrandData(clientId, next);
      if (!result.ok) return setError(result.error);
      ref.current?.close();
    });
  }

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="brand-editor-title"
      onClose={onClose}
      onCancel={(e) => {
        if (pending) e.preventDefault();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal-card modal-form brand-editor">
        <div className="modal-head">
          <h2 id="brand-editor-title">Editar manual de marca</h2>
          <button type="button" className="modal-close" onClick={close} aria-label="Cerrar">
            ×
          </button>
        </div>
        <form onSubmit={submit} noValidate className="stack-form">
          <label>
            Resumen de la marca
            <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} disabled={pending} />
          </label>

          <fieldset className="brand-fieldset">
            <legend>Colores</legend>
            {colors.map((c, i) => (
              <div key={i} className="brand-edit-row">
                <input
                  type="color"
                  aria-label="Elegir color"
                  value={normalizeHex(c.hex) ?? "#000000"}
                  onChange={(e) => setColor(i, { hex: e.target.value.toUpperCase(), rgb: null, cmyk: null })}
                  disabled={pending}
                />
                <input
                  aria-label="HEX"
                  value={c.hex}
                  onChange={(e) => setColor(i, { hex: e.target.value, rgb: null, cmyk: null })}
                  className="brand-edit-hex"
                  disabled={pending}
                />
                <input aria-label="Nombre" placeholder="Nombre" value={c.name} onChange={(e) => setColor(i, { name: e.target.value })} disabled={pending} />
                <input aria-label="Rol" placeholder="Rol (primario…)" value={c.role} onChange={(e) => setColor(i, { role: e.target.value })} disabled={pending} />
                <input aria-label="Pantone" placeholder="Pantone" value={c.pantone} onChange={(e) => setColor(i, { pantone: e.target.value })} disabled={pending} />
                <button
                  type="button"
                  className="icon-btn brand-edit-remove"
                  aria-label={`Quitar ${c.name || "color"}`}
                  onClick={() => setColors((list) => list.filter((_, j) => j !== i))}
                  disabled={pending}
                >
                  <Icon name="trash" size={15} />
                </button>
              </div>
            ))}
            <div>
              <ActionButton
                icon="plus"
                disabled={pending}
                onClick={() => setColors((list) => [...list, { name: "", hex: "#", role: "", pantone: "", usage: "", rgb: null, cmyk: null }])}
              >
                Agregar color
              </ActionButton>
            </div>
          </fieldset>

          <fieldset className="brand-fieldset">
            <legend>Tipografías</legend>
            {fonts.map((f, i) => (
              <div key={i} className="brand-edit-row fonts">
                <input aria-label="Familia" placeholder="Familia (p. ej. Montserrat)" value={f.family} onChange={(e) => setFont(i, { family: e.target.value })} disabled={pending} />
                <input aria-label="Rol" placeholder="Rol (títulos…)" value={f.role} onChange={(e) => setFont(i, { role: e.target.value })} disabled={pending} />
                <input aria-label="Pesos" placeholder="Pesos (Regular, Bold)" value={f.weights} onChange={(e) => setFont(i, { weights: e.target.value })} disabled={pending} />
                <button
                  type="button"
                  className="icon-btn brand-edit-remove"
                  aria-label={`Quitar ${f.family || "tipografía"}`}
                  onClick={() => setFonts((list) => list.filter((_, j) => j !== i))}
                  disabled={pending}
                >
                  <Icon name="trash" size={15} />
                </button>
              </div>
            ))}
            <div>
              <ActionButton icon="plus" disabled={pending} onClick={() => setFonts((list) => [...list, { family: "", role: "", weights: "", usage: "" }])}>
                Agregar tipografía
              </ActionButton>
            </div>
          </fieldset>

          <label>
            Logo
            <textarea value={logoDescription} onChange={(e) => setLogoDescription(e.target.value)} rows={2} disabled={pending} />
          </label>
          <label>
            Reglas del logo (una por línea)
            <textarea value={logoRules} onChange={(e) => setLogoRules(e.target.value)} rows={4} disabled={pending} />
          </label>
          <label>
            Tono de voz
            <textarea value={voice} onChange={(e) => setVoice(e.target.value)} rows={2} disabled={pending} />
          </label>
          <label>
            Palabras de la personalidad (separadas por coma)
            <input value={keywords} onChange={(e) => setKeywords(e.target.value)} disabled={pending} />
          </label>
          <div className="form-row">
            <label>
              Sí (una por línea)
              <textarea value={dos} onChange={(e) => setDos(e.target.value)} rows={4} disabled={pending} />
            </label>
            <label>
              No (una por línea)
              <textarea value={donts} onChange={(e) => setDonts(e.target.value)} rows={4} disabled={pending} />
            </label>
          </div>
          <label>
            Imágenes y gráficos (una por línea)
            <textarea value={imagery} onChange={(e) => setImagery(e.target.value)} rows={3} disabled={pending} />
          </label>

          {error && <p className="form-error modal-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={close} disabled={pending}>
              Cancelar
            </button>
            <button type="submit" className="connect-btn" disabled={pending}>
              {pending ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}

// Marca el logo elegido como principal (el que muestra el tablero).
export function MainLogoButton({ clientId, id }: { clientId: string; id: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <ActionButton
        icon="check"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await setMainLogo(clientId, id);
            if (!result.ok) setError(result.error);
          })
        }
      >
        {pending ? "Guardando…" : "Marcar como principal"}
      </ActionButton>
      {error && <p className="form-error brand-inline-error">{error}</p>}
    </>
  );
}
