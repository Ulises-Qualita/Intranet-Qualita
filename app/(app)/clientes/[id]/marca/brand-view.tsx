import { ActionLink } from "@/components/actions";
import { Topbar } from "@/components/topbar";
import { Card, EmptyState } from "@/components/ui";
import { brandApplicationMedia, brandPdfUrl, getBrandAssets, getBrandBook } from "@/lib/brand";
import {
  APPS_VERSION,
  type AssetKind,
  type BrandAsset,
  type BrandBook,
  type BrandData,
  type BrandFont,
  EMPTY_BRAND,
  fontKey,
  googleFontCss,
  googleFontPage,
  isItalic,
  weightOf,
} from "@/lib/brand-shared";
import type { Client } from "@/lib/data";
import { fileSize, shortDate } from "@/lib/format";
import { type BoardFile, type BoardFont, BrandBoard } from "./brand-board";
import { DeleteBookButton, EditBrandButton, ExtractButton, PdfUploader } from "./brand-ui";

// Manual de marca de un cliente: resuelve los datos (fuentes, URLs firmadas) y
// dibuja el tablero interactivo (brand-board.tsx). La usan el equipo
// (/clientes/[slug]/marca, con `internal`: una barra fina arriba para subir,
// leer, editar y borrar) y la cuenta del cliente (/mi-empresa/marca, solo ver y
// descargar; la solapa arranca apagada para el cliente). Quien la llama ya
// validó el acceso.

const downloadUrl = (url: string, name: string) => `${url}${url.includes("?") ? "&" : "?"}download=${encodeURIComponent(name)}`;
const isImage = (a: BrandAsset) => /^image\//.test(a.mimeType ?? "") || /\.(svg|png|jpe?g|webp)$/i.test(a.fileName);
const isWebFont = (a: BrandAsset) => /\.(otf|ttf|woff2?)$/i.test(a.fileName);
// Versiones en negativo del logo: van sobre el color de la marca.
const isNegative = (a: BrandAsset) => /blanc|white|negativ|neg\b|inverse|reverse/i.test(a.fileName);

// "principal" o "logo-negativo_2" (sale del nombre del archivo) → "Principal", "Logo negativo 2".
const displayName = (name: string) => {
  const clean = name.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim() || name;
  return clean.charAt(0).toUpperCase() + clean.slice(1);
};

const SAMPLE_WEIGHTS = ["Regular", "Bold"];

export async function BrandView({ c, internal }: { c: Client; internal: boolean }) {
  const [book, assets] = await Promise.all([getBrandBook(c.id), getBrandAssets(c.id)]);
  const header = !internal && <Topbar crumb={c.name} title="Manual de marca" />;

  if (book === null) {
    return (
      <>
        {header}
        <section className="view">
          <Card title="Manual de marca">
            <EmptyState label={internal ? "Falta la base" : "Sin manual"}>
              {internal ? (
                <>
                  Para cargar manuales hay que correr <b>docs/sql/2026-11-12-manual-de-marca.sql</b> en Supabase.
                </>
              ) : (
                "Todavía no hay un manual de marca cargado."
              )}
            </EmptyState>
          </Card>
        </section>
      </>
    );
  }

  if (!book && !assets.length) {
    return (
      <>
        {header}
        <section className="view">
          {internal ? (
            <PdfUploader clientId={c.id} clientSlug={c.slug} hero />
          ) : (
            <Card title="Manual de marca">
              <EmptyState label="Sin manual">Todavía no hay un manual de marca cargado.</EmptyState>
            </Card>
          )}
        </section>
      </>
    );
  }

  const [pdfView, pdfDownload] = book?.hasPdf ? await Promise.all([brandPdfUrl(c.id, false), brandPdfUrl(c.id, true)]) : [null, null];
  const data: BrandData = book?.data ?? EMPTY_BRAND;
  const media = await brandApplicationMedia(data);
  const byKind = (k: AssetKind) => assets.filter((a) => a.kind === k);
  const [logos, fontFiles, others] = [byKind("logo"), byKind("fuente"), byKind("otro")];

  // Fuentes: Google por hoja de estilos (una por peso), las subidas por @font-face.
  const faceFor = (family: string) => fontFiles.find((f) => isWebFont(f) && f.url && fontKey(f.fileName).startsWith(fontKey(family)));
  const fileFor = (family: string) => fontFiles.find((f) => fontKey(f.fileName).startsWith(fontKey(family)) || fontKey(f.name).startsWith(fontKey(family)));
  const cssFamily = (f: BrandFont) => (f.google ? `"${f.family}"` : faceFor(f.family) ? `"brand-${fontKey(f.family)}"` : `"${f.family}"`);
  const weightsOf = (f: BrandFont) => {
    const list = (f.weights?.length ? f.weights : SAMPLE_WEIGHTS).filter((w) => !isItalic(w));
    return [...new Map(list.map((w) => [weightOf(w) ?? 400, w])).entries()].sort((a, b) => a[0] - b[0]);
  };
  const googleSheets = [
    ...new Set(data.fonts.filter((f) => f.google).flatMap((f) => [googleFontCss(f.family), ...weightsOf(f).map(([w]) => googleFontCss(f.family, w))])),
  ];

  const toFile = (a: BrandAsset): BoardFile => ({
    id: a.id,
    name: displayName(a.name),
    fileName: a.fileName,
    url: a.url,
    download: a.url ? downloadUrl(a.url, a.fileName) : null,
    image: isImage(a),
    negative: isNegative(a),
    background: a.kind === "logo" ? (data.logo.backgrounds?.[a.id] ?? null) : null,
    size: fileSize(a.size),
    kind: a.kind,
  });

  const fonts: BoardFont[] = data.fonts.map((f) => {
    const file = fileFor(f.family);
    return {
      family: f.family,
      role: f.role ?? null,
      usage: f.usage ?? null,
      css: `${cssFamily(f)}, var(--font-display), sans-serif`,
      weights: weightsOf(f),
      download: file?.url
        ? { href: downloadUrl(file.url, file.fileName), external: false, label: "Descargar" }
        : f.google
          ? { href: googleFontPage(f.family), external: true, label: "Google Fonts" }
          : null,
    };
  });

  return (
    <>
      {header}
      {googleSheets.map((href) => (
        <link key={href} rel="stylesheet" href={href} precedence="default" />
      ))}
      {data.fonts.some((f) => !f.google && faceFor(f.family)) && (
        <style>
          {data.fonts
            .filter((f) => !f.google && faceFor(f.family))
            .map((f) => `@font-face{font-family:"brand-${fontKey(f.family)}";src:url("${faceFor(f.family)!.url}");font-display:swap;}`)
            .join("\n")}
        </style>
      )}

      <section className="view brand-view">
        {internal && <AdminBar c={c} book={book} data={data} pdfView={pdfView} />}
        <BrandBoard
          clientId={c.id}
          clientSlug={c.slug}
          logoSources={data.logo.sources}
          mainLogo={data.logo.main ?? null}
          applications={media.apps}
          appsSearched={data.applications !== undefined && data.applicationsVersion === APPS_VERSION}
          name={c.name}
          internal={internal}
          summary={data.summary}
          colors={data.colors}
          fonts={fonts}
          logos={logos.map(toFile)}
          files={[...fontFiles, ...others].map(toFile)}
          logoNotes={{ description: data.logo.description ?? null, rules: data.logo.rules }}
          voice={{ ...data.voice, description: data.voice.description ?? null }}
          imagery={data.imagery}
          pdf={pdfView ? { view: pdfView, download: pdfDownload, size: fileSize(book?.pdfSize ?? null) } : null}
        />
      </section>
    </>
  );
}

// Herramientas del equipo, en una línea fina arriba del manual (no forman parte de él).
function AdminBar({ c, book, data, pdfView }: { c: Client; book: BrandBook | undefined; data: BrandData; pdfView: string | null }) {
  return (
    <div className="bh-admin">
      <div className="bh-admin-info">
        {book?.pdfName ? (
          <>
            <b>{book.pdfName}</b>
            <span>
              {fileSize(book.pdfSize)}
              {book.extractedAt && ` · leído el ${shortDate(book.extractedAt.slice(0, 10))}`}
            </span>
          </>
        ) : (
          <span>Sin PDF</span>
        )}
        {book?.status === "extrayendo" && <span className="bh-admin-status">Leyendo el manual…</span>}
        {book?.status === "sin_extraer" && book.hasPdf && !book.data && <span className="bh-admin-status">Falta leerlo</span>}
      </div>
      <div className="bh-admin-actions">
        {pdfView && (
          <ActionLink icon="eye" href={pdfView} external>
            Ver PDF
          </ActionLink>
        )}
        {book && <EditBrandButton clientId={c.id} data={data} />}
        {book?.hasPdf && <ExtractButton clientSlug={c.slug} status={book.status} />}
        <PdfUploader clientId={c.id} clientSlug={c.slug} />
        {book && <DeleteBookButton clientId={c.id} />}
      </div>
      {book?.status === "error" && <p className="form-error bh-admin-error">{book.error ?? "No se pudo leer el manual."}</p>}
    </div>
  );
}
