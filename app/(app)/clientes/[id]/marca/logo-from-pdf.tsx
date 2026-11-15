"use client";

import { type PointerEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import { ActionButton } from "@/components/actions";
import { Icon } from "@/components/icons";
import { BRAND_BUCKET, type BrandApplication, type LogoSource } from "@/lib/brand-shared";
import { createClient } from "@/lib/supabase/client";
import { createBrandUpload, saveBrandApplications } from "./actions";
import { uploadFile } from "./brand-ui";

// Sacar el logo del PDF del manual: Claude marca en qué página y en qué parte está
// cada versión (data.logo.sources, al leer el manual o con /api/marca/logos), el
// navegador dibuja esa zona con pdf.js en alta resolución, la recorta al borde y,
// si el fondo es liso, lo vuelve transparente. Se revisa, se ajusta arrastrando
// sobre la página y se guarda como logo PNG (los mismos recursos que se suben a mano).

type Box = { x: number; y: number; w: number; h: number };
type Item = { id: number; page: number; name: string; box: Box; transparent: boolean; keep: boolean };
type Crop = { url: string; blob: Blob; flat: boolean };

// ---------- pdf.js (se carga solo al abrir) ----------

let pdfjs: Promise<typeof import("pdfjs-dist")> | null = null;
function loadPdfjs() {
  pdfjs ??= import("pdfjs-dist").then((lib) => {
    lib.GlobalWorkerOptions.workerPort = new Worker(new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url), { type: "module" });
    return lib;
  });
  return pdfjs;
}

// ---------- Recorte ----------

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const LONG_SIDE = 2000; // px del lado largo de la zona recortada

// Color del fondo si las cuatro esquinas coinciden (fondo liso); si no, null.
function flatBackground(d: Uint8ClampedArray, w: number, h: number): [number, number, number] | null {
  const at = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return [d[i], d[i + 1], d[i + 2]] as [number, number, number];
  };
  const corners = [at(1, 1), at(w - 2, 1), at(1, h - 2), at(w - 2, h - 2)];
  const far = corners.some((c) => corners.some((o) => Math.max(...c.map((v, k) => Math.abs(v - o[k]))) > 18));
  if (far) return null;
  return [0, 1, 2].map((k) => Math.round(corners.reduce((s, c) => s + c[k], 0) / 4)) as [number, number, number];
}

async function cropLogo(doc: PDFDocumentProxy, item: Item): Promise<Crop> {
  const page = await doc.getPage(item.page);
  const base = page.getViewport({ scale: 1 });
  const pad = 0.012;
  const x0 = clamp(item.box.x - pad);
  const y0 = clamp(item.box.y - pad);
  const x1 = clamp(item.box.x + item.box.w + pad);
  const y1 = clamp(item.box.y + item.box.h + pad);
  const scale = Math.min(14, LONG_SIDE / Math.max((x1 - x0) * base.width, (y1 - y0) * base.height, 1));
  const vp = page.getViewport({ scale });
  const w = Math.max(2, Math.round((x1 - x0) * vp.width));
  const h = Math.max(2, Math.round((y1 - y0) * vp.height));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  await page.render({ canvas, viewport: vp, transform: [1, 0, 0, 1, -x0 * vp.width, -y0 * vp.height] }).promise;

  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const bg = flatBackground(d, w, h);

  // Con fondo liso: borde justo (lo que se distingue del fondo) y, si se pide,
  // fondo transparente separando el color del fondo (sin halo en los bordes).
  let [minX, minY, maxX, maxY] = [0, 0, w - 1, h - 1];
  if (bg) {
    [minX, minY, maxX, maxY] = [w, h, -1, -1];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const diff = Math.max(Math.abs(d[i] - bg[0]), Math.abs(d[i + 1] - bg[1]), Math.abs(d[i + 2] - bg[2]));
        if (diff > 24) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        if (item.transparent) {
          const a = Math.min(1, Math.max(0, (diff - 6) / 70));
          if (a === 0) d[i + 3] = 0;
          else if (a < 1) {
            for (let k = 0; k < 3; k++) d[i + k] = Math.min(255, Math.max(0, Math.round((d[i + k] - bg[k] * (1 - a)) / a)));
            d[i + 3] = Math.round(a * 255);
          }
        }
      }
    }
    if (maxX < minX) [minX, minY, maxX, maxY] = [0, 0, w - 1, h - 1];
    if (item.transparent) ctx.putImageData(img, 0, 0);
  }

  const margin = Math.round(Math.max(maxX - minX, maxY - minY) * 0.04);
  const ox = Math.max(0, minX - margin);
  const oy = Math.max(0, minY - margin);
  const ow = Math.min(w, maxX + margin + 1) - ox;
  const oh = Math.min(h, maxY + margin + 1) - oy;
  const out = document.createElement("canvas");
  out.width = ow;
  out.height = oh;
  out.getContext("2d")!.drawImage(canvas, ox, oy, ow, oh, 0, 0, ow, oh);
  const blob = await new Promise<Blob>((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error("png"))), "image/png"));
  return { url: URL.createObjectURL(blob), blob, flat: !!bg };
}

const fileName = (name: string) =>
  `${
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "logo"
  }.png`;

// Después de leer el manual: recorta cada logo que marcó Claude (fondo
// transparente si es liso) y lo guarda, sin pasar por el panel. Devuelve un error
// para mostrar, o null. Lo usa runExtraction (brand-ui.tsx) con import dinámico.
export async function saveLogosFromPdf(clientId: string, pdfUrl: string, sources: LogoSource[]): Promise<string | null> {
  const lib = await loadPdfjs();
  const loading = lib.getDocument({ url: pdfUrl });
  try {
    const doc = await loading.promise;
    const used = new Set<string>();
    let failed = 0;
    for (const s of sources) {
      try {
        const crop = await cropLogo(doc, toItem(s));
        URL.revokeObjectURL(crop.url);
        let name = fileName(s.name);
        for (let n = 2; used.has(name); n++) name = fileName(`${s.name} ${n}`);
        used.add(name);
        if (await uploadFile(clientId, "logo", new File([crop.blob], name, { type: "image/png" }))) failed++;
      } catch {
        failed++;
      }
    }
    return failed ? `No se pudieron guardar ${failed === 1 ? "un logo" : `${failed} logos`} del PDF. Probá con “Sacar del PDF”.` : null;
  } catch {
    return "No se pudo abrir el PDF para sacar el logo.";
  } finally {
    void loading.destroy();
  }
}

// ---------- Aplicaciones ----------

type Matrix = [number, number, number, number, number, number];
const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

// Píxeles por punto de las fotos del PDF que caen en esa zona de la página (la de
// más resolución entre las que cubren al menos un 15%), o null si ahí no hay
// fotos (texto y vectores). Recorre los operadores de la página siguiendo la
// matriz de cada imagen. Hace falta porque pdf.js agranda las fotos sin
// suavizar: pasadas a 1800 px salían pixeladas (un posteo de 211 px, casi 7 veces).
async function imageDensity(lib: typeof import("pdfjs-dist"), page: PDFPageProxy, x0: number, y0: number, x1: number, y1: number): Promise<number | null> {
  const { OPS } = lib;
  const [vx0, vy0, vx1, vy1] = page.view;
  const list = await page.getOperatorList();
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  const area = Math.max((x1 - x0) * (y1 - y0), 1e-6);
  let best: number | null = null;
  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i];
    const args = list.argsArray[i] as unknown[];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = mul(ctm, args as Matrix);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      if (Array.isArray(args[0])) ctm = mul(ctm, args[0] as Matrix);
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
      const inline = args[0] as { width?: number; height?: number } | null;
      const w = Number(fn === OPS.paintImageXObject ? args[1] : inline?.width);
      const h = Number(fn === OPS.paintImageXObject ? args[2] : inline?.height);
      const [wPt, hPt] = [Math.hypot(ctm[0], ctm[1]), Math.hypot(ctm[2], ctm[3])];
      if (!(w > 0 && h > 0 && wPt > 0 && hPt > 0)) continue;
      // Caja de la imagen en fracciones de la página (el PDF mide desde abajo).
      const xs = [ctm[4], ctm[4] + ctm[0], ctm[4] + ctm[2], ctm[4] + ctm[0] + ctm[2]].map((v) => (v - vx0) / (vx1 - vx0));
      const ys = [ctm[5], ctm[5] + ctm[1], ctm[5] + ctm[3], ctm[5] + ctm[1] + ctm[3]].map((v) => 1 - (v - vy0) / (vy1 - vy0));
      const ox = Math.min(x1, Math.max(...xs)) - Math.max(x0, Math.min(...xs));
      const oy = Math.min(y1, Math.max(...ys)) - Math.max(y0, Math.min(...ys));
      if (ox <= 0 || oy <= 0 || (ox * oy) / area < 0.15) continue;
      const density = Math.max(w / wPt, h / hPt);
      if (best === null || density > best) best = density;
    }
  }
  return best;
}

// Recorta una aplicación tal cual está en la página (sin quitar el fondo), como
// JPG. Si es una foto, a su resolución real (la vista grande la agranda
// suavizada); si es texto o vectores, a 1800 px de lado largo.
async function cropApplication(lib: typeof import("pdfjs-dist"), doc: PDFDocumentProxy, a: BrandApplication): Promise<Blob> {
  const page = await doc.getPage(a.page);
  const base = page.getViewport({ scale: 1 });
  const [x0, y0] = [clamp(a.x), clamp(a.y)];
  const [x1, y1] = [clamp(a.x + a.w), clamp(a.y + a.h)];
  const full = Math.min(8, 1800 / Math.max((x1 - x0) * base.width, (y1 - y0) * base.height, 1));
  const density = await imageDensity(lib, page, x0, y0, x1, y1).catch(() => null);
  const scale = density ? Math.min(full, Math.max(density, 0.5)) : full;
  const vp = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(2, Math.round((x1 - x0) * vp.width));
  canvas.height = Math.max(2, Math.round((y1 - y0) * vp.height));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, viewport: vp, transform: [1, 0, 0, 1, -x0 * vp.width, -y0 * vp.height] }).promise;
  const out = trimToContent(canvas);
  return new Promise<Blob>((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error("jpg"))), "image/jpeg", 0.92));
}

// Si la zona tiene fondo liso (la página del manual alrededor de la pieza), la
// recorta al borde de lo que se distingue del fondo: la caja de Claude suele
// quedar holgada y así cada posteo queda justo, sin margen ni pedazos del vecino.
function trimToContent(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const { width: w, height: h } = canvas;
  const d = canvas.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const bg = flatBackground(d, w, h);
  if (!bg) return canvas;
  let [minX, minY, maxX, maxY] = [w, h, -1, -1];
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4;
      if (Math.max(Math.abs(d[i] - bg[0]), Math.abs(d[i + 1] - bg[1]), Math.abs(d[i + 2] - bg[2])) > 24) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  // Nada distinto del fondo, o casi lo mismo que ya había: queda como está.
  if (maxX < minX || (maxX - minX) * (maxY - minY) > w * h * 0.94) return canvas;
  const ow = Math.min(w, maxX + 2) - minX;
  const oh = Math.min(h, maxY + 2) - minY;
  if (ow < 40 || oh < 40) return canvas;
  const out = document.createElement("canvas");
  out.width = ow;
  out.height = oh;
  out.getContext("2d")!.drawImage(canvas, minX, minY, ow, oh, 0, 0, ow, oh);
  return out;
}

// Sube una imagen a `{clientId}/aplicacion/`; devuelve la ruta o null.
async function uploadImage(clientId: string, blob: Blob, name: string): Promise<string | null> {
  const signed = await createBrandUpload(clientId, "aplicacion", { name, size: blob.size });
  if (!signed.ok) return null;
  const { error } = await createClient().storage.from(BRAND_BUCKET).uploadToSignedUrl(signed.path, signed.token, blob, { contentType: "image/jpeg" });
  return error ? null : signed.path;
}

// Recorta cada aplicación que marcó Claude, la sube al bucket y guarda la lista
// (reemplaza la anterior). Devuelve un error para mostrar, o null.
export async function saveApplicationsFromPdf(clientId: string, pdfUrl: string, apps: BrandApplication[]): Promise<string | null> {
  if (!apps.length) {
    // Buscadas y sin piezas: queda guardado, así no se vuelven a buscar.
    const result = await saveBrandApplications(clientId, []);
    return result.ok ? null : result.error;
  }
  const lib = await loadPdfjs();
  const loading = lib.getDocument({ url: pdfUrl });
  try {
    const doc = await loading.promise;
    const saved: BrandApplication[] = [];
    for (const [i, a] of apps.entries()) {
      try {
        const path = await uploadImage(clientId, await cropApplication(lib, doc, a), `${i + 1}-${fileName(a.name).replace(/\.png$/, ".jpg")}`);
        if (path) saved.push({ ...a, path });
      } catch {
        // Una que no se pudo recortar no frena al resto.
      }
    }
    const result = await saveBrandApplications(clientId, saved);
    if (!result.ok) return result.error;
    const failed = apps.length - saved.length;
    return failed ? `No se pudieron sacar ${failed === 1 ? "una aplicación" : `${failed} aplicaciones`} del PDF.` : null;
  } catch {
    return "No se pudo abrir el PDF para sacar las aplicaciones.";
  } finally {
    void loading.destroy();
  }
}

// Aplicaciones de un manual ya leído: Claude marca las piezas
// (/api/marca/aplicaciones) y se recortan acá. Lo corre solo el tablero cuando
// todavía no se buscaron, y el botón "Volver a sacar del PDF". Devuelve un error o null.
export async function extractApplications(clientSlug: string, onCropping?: () => void): Promise<string | null> {
  const res = await fetch("/api/marca/aplicaciones", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client: clientSlug }),
  }).catch(() => null);
  const json = (await res?.json().catch(() => null)) as
    | { ok: true; clientId: string; pdfUrl: string; applications: BrandApplication[] }
    | { ok: false; error: string }
    | null;
  if (!json?.ok) return json?.error ?? "No se pudieron buscar las aplicaciones.";
  onCropping?.();
  return saveApplicationsFromPdf(json.clientId, json.pdfUrl, json.applications);
}

export function ApplicationsFromPdf({ clientSlug, label }: { clientSlug: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"buscando" | "recortando" | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setError(null);
    setBusy("buscando");
    const failed = await extractApplications(clientSlug, () => setBusy("recortando"));
    setBusy(null);
    if (failed) setError(failed);
    router.refresh();
  }
  return (
    <>
      <ActionButton icon="sparkles" disabled={!!busy} onClick={() => void run()}>
        {busy === "buscando" ? "Buscando en el PDF…" : busy === "recortando" ? "Recortando…" : label}
      </ActionButton>
      {error && <p className="form-error">{error}</p>}
    </>
  );
}

// ---------- Botón ----------

export function LogoFromPdf({
  clientId,
  clientSlug,
  pdfUrl,
  sources,
  label = "Sacar del PDF",
}: {
  clientId: string;
  clientSlug: string;
  pdfUrl: string;
  sources: LogoSource[] | undefined;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ActionButton icon="sparkles" onClick={() => setOpen(true)}>
        {label}
      </ActionButton>
      {open && <LogoPicker clientId={clientId} clientSlug={clientSlug} pdfUrl={pdfUrl} sources={sources} onClose={() => setOpen(false)} />}
    </>
  );
}

// ---------- Panel ----------

let nextId = 1;
const toItem = (s: LogoSource): Item => ({
  id: nextId++,
  page: s.page,
  name: s.name,
  box: { x: s.x, y: s.y, w: s.w, h: s.h },
  transparent: true,
  keep: true,
});

function LogoPicker({
  clientId,
  clientSlug,
  pdfUrl,
  sources,
  onClose,
}: {
  clientId: string;
  clientSlug: string;
  pdfUrl: string;
  sources: LogoSource[] | undefined;
  onClose: () => void;
}) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [step, setStep] = useState<"cargando" | "buscando" | "listo" | "guardando">(sources ? "cargando" : "buscando");
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>(() => (sources ?? []).map(toItem));
  const [current, setCurrent] = useState(0);
  const [crops, setCrops] = useState<Record<number, Crop>>({});
  const item = items[current];

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  // PDF y, si el manual se leyó antes de que Claude marcara el logo, la búsqueda.
  useEffect(() => {
    let alive = true;
    let task: { destroy(): Promise<void> } | null = null;
    (async () => {
      const search = sources
        ? null
        : fetch("/api/marca/logos", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ client: clientSlug }),
          })
            .then((r) => r.json() as Promise<{ ok: boolean; sources?: LogoSource[]; error?: string }>)
            .catch(() => ({ ok: false, error: "No se pudo buscar el logo." }) as { ok: boolean; sources?: LogoSource[]; error?: string });
      try {
        const lib = await loadPdfjs();
        const loading = lib.getDocument({ url: pdfUrl });
        task = loading;
        const loaded = await loading.promise;
        if (!alive) return;
        setDoc(loaded);
      } catch {
        if (alive) setError("No se pudo abrir el PDF.");
      }
      if (search) {
        const found = await search;
        if (!alive) return;
        if (!found.ok) setError(found.error ?? "No se pudo buscar el logo.");
        else {
          setItems((found.sources ?? []).map(toItem));
          router.refresh();
        }
      }
      if (alive) setStep("listo");
    })();
    return () => {
      alive = false;
      void task?.destroy();
    };
    // Solo al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recorte de cada logo (y de nuevo al ajustarlo).
  const key = items.map((i) => `${i.id}:${i.page}:${i.box.x}:${i.box.y}:${i.box.w}:${i.box.h}:${i.transparent}`).join("|");
  useEffect(() => {
    if (!doc) return;
    let alive = true;
    const timer = setTimeout(async () => {
      for (const it of items) {
        try {
          const crop = await cropLogo(doc, it);
          if (!alive) return URL.revokeObjectURL(crop.url);
          setCrops((prev) => {
            if (prev[it.id]) URL.revokeObjectURL(prev[it.id].url);
            return { ...prev, [it.id]: crop };
          });
        } catch {
          // Página fuera de rango o cancelada: queda sin vista previa.
        }
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // `key` resume `items`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, key]);

  useEffect(() => () => Object.values(crops).forEach((c) => URL.revokeObjectURL(c.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (patch: Partial<Item>) => setItems((list) => list.map((it, i) => (i === current ? { ...it, ...patch } : it)));

  function add() {
    const page = item?.page ?? 1;
    setItems((list) => [...list, { id: nextId++, page, name: `Logo ${list.length + 1}`, box: { x: 0.25, y: 0.3, w: 0.5, h: 0.4 }, transparent: true, keep: true }]);
    setCurrent(items.length);
  }

  async function save() {
    const chosen = items.filter((it) => it.keep && crops[it.id]);
    if (!chosen.length) return setError("Elegí al menos un logo.");
    setStep("guardando");
    setError(null);
    for (const it of chosen) {
      const file = new File([crops[it.id].blob], fileName(it.name), { type: "image/png" });
      const failed = await uploadFile(clientId, "logo", file);
      if (failed) {
        setStep("listo");
        return setError(`${it.name}: ${failed}`);
      }
    }
    router.refresh();
    ref.current?.close();
  }

  const busy = step === "guardando";
  const kept = items.filter((it) => it.keep && crops[it.id]).length;

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="lp-title"
      onClose={onClose}
      onCancel={(e) => {
        if (busy) e.preventDefault();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) ref.current?.close();
      }}
    >
      <div className="modal-card lp">
        <div className="modal-head">
          <h2 id="lp-title">Logos del PDF</h2>
          <button type="button" className="modal-close" onClick={() => ref.current?.close()} aria-label="Cerrar" disabled={busy}>
            ×
          </button>
        </div>

        {step === "cargando" || step === "buscando" ? (
          <div className="lp-wait">
            <Icon name="sparkles" size={22} />
            <b>{step === "buscando" ? "Claude está buscando el logo en el manual…" : "Abriendo el PDF…"}</b>
            {step === "buscando" && <span>Puede tardar un minuto.</span>}
          </div>
        ) : (
          <div className="lp-body">
            <div className="lp-list">
              {items.map((it, i) => (
                <div key={it.id} className={`lp-item${i === current ? " on" : ""}`}>
                  <button type="button" className="lp-thumb" onClick={() => setCurrent(i)} aria-label={`Ver ${it.name}`}>
                    {crops[it.id] ? (
                      // eslint-disable-next-line @next/next/no-img-element -- recorte local (blob:).
                      <img src={crops[it.id].url} alt="" />
                    ) : (
                      <span className="lp-spin" />
                    )}
                  </button>
                  <label className="lp-keep">
                    <input type="checkbox" checked={it.keep} onChange={(e) => setItems((l) => l.map((x) => (x.id === it.id ? { ...x, keep: e.target.checked } : x)))} disabled={busy} />
                    <span>{it.name}</span>
                  </label>
                </div>
              ))}
              <button type="button" className="lp-add" onClick={add} disabled={busy || !doc}>
                <Icon name="plus" size={14} strokeWidth={2} /> Marcar otro
              </button>
            </div>

            {item && doc ? (
              <div className="lp-edit">
                <div className="lp-edit-head">
                  <input className="lp-name" value={item.name} onChange={(e) => update({ name: e.target.value.slice(0, 60) })} aria-label="Nombre" disabled={busy} />
                  <div className="lp-pages">
                    <button type="button" onClick={() => update({ page: Math.max(1, item.page - 1) })} disabled={busy || item.page <= 1} aria-label="Página anterior">
                      ←
                    </button>
                    <span>
                      Pág. {item.page} de {doc.numPages}
                    </span>
                    <button type="button" onClick={() => update({ page: Math.min(doc.numPages, item.page + 1) })} disabled={busy || item.page >= doc.numPages} aria-label="Página siguiente">
                      →
                    </button>
                  </div>
                </div>
                <div className="lp-panes">
                  <PageSelect doc={doc} page={item.page} box={item.box} onBox={(box) => update({ box })} disabled={busy} />
                  <div className="lp-result">
                    <div className="lp-preview">
                      {crops[item.id] ? (
                        // eslint-disable-next-line @next/next/no-img-element -- recorte local (blob:).
                        <img src={crops[item.id].url} alt={item.name} />
                      ) : (
                        <span className="lp-spin" />
                      )}
                    </div>
                    <label className="lp-toggle">
                      <input type="checkbox" checked={item.transparent} onChange={(e) => update({ transparent: e.target.checked })} disabled={busy} />
                      <span>Fondo transparente</span>
                    </label>
                    {crops[item.id] && !crops[item.id].flat && <p className="lp-note">El fondo no es liso: se recorta tal cual.</p>}
                    <p className="lp-note">Arrastrá sobre la página para marcar otra zona.</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="lp-wait">
                <b>{items.length ? "Abriendo el PDF…" : "No encontramos el logo en el manual."}</b>
                {!items.length && doc && <span>Marcalo a mano con “Marcar otro”.</span>}
              </div>
            )}
          </div>
        )}

        {error && <p className="form-error">{error}</p>}
        <div className="lp-foot">
          <span>PNG en alta resolución. Si tenés el SVG o el AI, subilo aparte.</span>
          <button type="button" className="btn-primary" onClick={save} disabled={busy || !kept}>
            <Icon name="download" size={15} strokeWidth={2} />
            {busy ? "Guardando…" : kept > 1 ? `Guardar ${kept} logos` : "Guardar logo"}
          </button>
        </div>
      </div>
    </dialog>
  );
}

// La página entera, con la caja marcada; arrastrar dibuja otra.
function PageSelect({ doc, page, box, onBox, disabled }: { doc: PDFDocumentProxy; page: number; box: Box; onBox: (b: Box) => void; disabled: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<Box | null>(null);
  const [ratio, setRatio] = useState(1.4142);

  useEffect(() => {
    let task: RenderTask | null = null;
    let alive = true;
    (async () => {
      const p = await doc.getPage(page);
      if (!alive || !canvas.current) return;
      const base = p.getViewport({ scale: 1 });
      setRatio(base.height / base.width);
      const scale = Math.min(3, (620 * Math.min(2, window.devicePixelRatio || 1)) / base.width);
      const vp = p.getViewport({ scale });
      canvas.current.width = Math.round(vp.width);
      canvas.current.height = Math.round(vp.height);
      task = p.render({ canvas: canvas.current, viewport: vp });
      await task.promise.catch(() => {});
    })();
    return () => {
      alive = false;
      task?.cancel();
    };
  }, [doc, page]);

  const point = (e: PointerEvent) => {
    const r = wrap.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
  };
  const between = (a: { x: number; y: number }, b: { x: number; y: number }): Box => ({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  });

  const shown = draft ?? box;
  return (
    <div
      ref={wrap}
      className="lp-page"
      style={{ aspectRatio: `1 / ${ratio}` }}
      onPointerDown={(e) => {
        if (disabled) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = point(e);
        setDraft({ ...start.current, w: 0, h: 0 });
      }}
      onPointerMove={(e) => {
        if (start.current) setDraft(between(start.current, point(e)));
      }}
      onPointerUp={(e) => {
        if (!start.current) return;
        const b = between(start.current, point(e));
        start.current = null;
        setDraft(null);
        if (b.w > 0.01 && b.h > 0.01) onBox(b);
      }}
    >
      <canvas ref={canvas} />
      <div className="lp-shade" style={{ left: `${shown.x * 100}%`, top: `${shown.y * 100}%`, width: `${shown.w * 100}%`, height: `${shown.h * 100}%` }} />
    </div>
  );
}
