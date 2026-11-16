// Manual de marca de un cliente: lectura, URLs firmadas y la extracción del PDF
// con Claude. Solo server. Tablas y bucket: docs/sql/2026-11-12-manual-de-marca.sql.
import Anthropic, { toFile } from "@anthropic-ai/sdk";
import { addUsage, emptyTokens, recordUsage } from "./agent/usage";
import { aiChoice } from "./ai-config";
import {
  type AssetKind,
  BRAND_BUCKET,
  type BrandAsset,
  type BrandBook,
  type BrandData,
  type BrandStatus,
  APPS_VERSION,
  EMPTY_BRAND,
  type ApplicationPage,
  type BrandApplication,
  type LogoSource,
  googleFontCss,
  normalizeHex,
} from "./brand-shared";
import { createAdminClient, createClient, isMissingTable } from "./supabase/server";

type BookRow = {
  client_id: string;
  pdf_path: string | null;
  pdf_name: string | null;
  pdf_size: number | null;
  data: BrandData | null;
  status: BrandStatus;
  error: string | null;
  extracted_at: string | null;
  updated_at: string;
};

type AssetRow = {
  id: string;
  kind: AssetKind;
  name: string;
  file_path: string;
  file_name: string;
  mime_type: string | null;
  size: number | null;
  created_at: string;
};

const bucket = () => createAdminClient().storage.from(BRAND_BUCKET);

// Con la sesión (RLS). null si las tablas todavía no existen; undefined si el
// cliente todavía no tiene manual.
export async function getBrandBook(clientId: string): Promise<BrandBook | null | undefined> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("intranet_brand_books").select("*").eq("client_id", clientId).maybeSingle<BookRow>();
  if (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }
  if (!data) return undefined;
  return {
    clientId: data.client_id,
    pdfName: data.pdf_name,
    pdfSize: data.pdf_size,
    hasPdf: !!data.pdf_path,
    data: data.data ? normalizeBrand(data.data) : null,
    status: data.status,
    error: data.error,
    extractedAt: data.extracted_at,
    updatedAt: data.updated_at,
  };
}

// Recursos con su URL firmada (válida 2 horas: lo que dura una visita larga).
export async function getBrandAssets(clientId: string): Promise<BrandAsset[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("intranet_brand_assets")
    .select("id, kind, name, file_path, file_name, mime_type, size, created_at")
    .eq("client_id", clientId)
    .order("created_at")
    .returns<AssetRow[]>();
  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  const rows = data ?? [];
  if (!rows.length) return [];
  const { data: signed } = await bucket().createSignedUrls(
    rows.map((r) => r.file_path),
    2 * 60 * 60,
  );
  const urlOf = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    name: r.name,
    fileName: r.file_name,
    mimeType: r.mime_type,
    size: r.size,
    url: urlOf.get(r.file_path) ?? null,
    createdAt: r.created_at,
  }));
}

// Link para ver o bajar el PDF (quien llama ya validó el acceso al cliente).
export async function brandPdfUrl(clientId: string, download: boolean): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("intranet_brand_books")
    .select("pdf_path, pdf_name")
    .eq("client_id", clientId)
    .maybeSingle<{ pdf_path: string | null; pdf_name: string | null }>();
  if (!data?.pdf_path) return null;
  const { data: signed } = await bucket().createSignedUrl(data.pdf_path, 60 * 60, download ? { download: data.pdf_name ?? true } : undefined);
  return signed?.signedUrl ?? null;
}

// ---------- Normalización ----------

const text = (v: unknown, max = 600) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const texts = (v: unknown, max = 20) => (Array.isArray(v) ? v.map((x) => text(x, 300)).filter((x): x is string => !!x).slice(0, max) : []);

const fraction = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null);

function logoSources(v: unknown): LogoSource[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v
    .flatMap((s: Record<string, unknown>) => {
      const [x, y, w, h] = [fraction(s?.x), fraction(s?.y), fraction(s?.w), fraction(s?.h)];
      const page = typeof s?.page === "number" ? Math.round(s.page) : 0;
      if (page < 1 || x === null || y === null || !w || !h) return [];
      return [{ page, name: text(s.name, 60) ?? "Logo", x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) }];
    })
    .slice(0, 8);
}

function applicationSources(v: unknown): BrandApplication[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v
    .flatMap((s: Record<string, unknown>) => {
      const [box] = logoSources([s]) ?? [];
      if (!box) return [];
      const path = typeof s.path === "string" && /^[\w-]+\/aplicacion\/[\w.-]+$/.test(s.path) ? s.path : null;
      return [{ ...box, name: text(s.name, 80) ?? "Aplicación", kind: s.kind === "redes" ? ("redes" as const) : s.kind === "estilo" ? ("estilo" as const) : ("aplicacion" as const), path }];
    })
    .slice(0, 28);
}

function applicationPages(v: unknown): ApplicationPage[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v
    .flatMap((p: Record<string, unknown>) =>
      typeof p?.page === "number" && p.page >= 1 && typeof p.path === "string" && /^[\w-]+\/aplicacion\/[\w.-]+$/.test(p.path)
        ? [{ page: Math.round(p.page), path: p.path }]
        : [],
    )
    .slice(0, 16);
}

// Lo que venga (de Claude o del editor), limpio: HEX válidos, sin vacíos.
// Fondos elegidos a mano: id del logo → #RRGGBB (los inválidos se descartan).
function logoBackgrounds(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const entries = Object.entries(raw as Record<string, unknown>).flatMap(([id, hex]) => {
    const color = normalizeHex(hex);
    return id.length <= 60 && color ? [[id, color] as const] : [];
  });
  return entries.length ? Object.fromEntries(entries) : undefined;
}

export function normalizeBrand(raw: unknown): BrandData {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const logo = (o.logo ?? {}) as Record<string, unknown>;
  const voice = (o.voice ?? {}) as Record<string, unknown>;
  const colors = (Array.isArray(o.colors) ? o.colors : []).flatMap((c: Record<string, unknown>) => {
    const hex = normalizeHex(c?.hex);
    if (!hex) return [];
    return [
      {
        name: text(c.name, 80) ?? hex,
        hex,
        rgb: text(c.rgb, 40),
        cmyk: text(c.cmyk, 40),
        pantone: text(c.pantone, 60),
        role: text(c.role, 40),
        usage: text(c.usage, 300),
      },
    ];
  });
  const fonts = (Array.isArray(o.fonts) ? o.fonts : []).flatMap((f: Record<string, unknown>) => {
    const family = text(f?.family, 80);
    if (!family) return [];
    return [{ family, role: text(f.role, 40), weights: texts(f.weights, 12), usage: text(f.usage, 300), google: f.google === true }];
  });
  return {
    summary: text(o.summary, 1200) ?? "",
    colors: colors.slice(0, 40),
    fonts: fonts.slice(0, 12),
    logo: {
      description: text(logo.description, 800),
      rules: texts(logo.rules),
      sources: logoSources(logo.sources),
      main: text(logo.main, 60),
      backgrounds: logoBackgrounds(logo.backgrounds),
    },
    voice: { description: text(voice.description, 800), keywords: texts(voice.keywords, 12), dos: texts(voice.dos), donts: texts(voice.donts) },
    imagery: texts(o.imagery),
    applications: applicationSources(o.applications),
    applicationPages: applicationPages(o.applicationPages),
    applicationsVersion: typeof o.applicationsVersion === "number" ? o.applicationsVersion : undefined,
  };
}

// Marca qué familias están en Google Fonts: la hoja de estilos responde 400 si no existe.
export async function checkGoogleFonts(data: BrandData): Promise<BrandData> {
  const fonts = await Promise.all(
    data.fonts.map(async (f) => {
      const ok = await fetch(googleFontCss(f.family), { cache: "no-store" })
        .then((r) => r.ok)
        .catch(() => false);
      return { ...f, google: ok };
    }),
  );
  return { ...data, fonts };
}

// ---------- Extracción con Claude ----------

const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] } as const;
const stringList = { type: "array", items: { type: "string" } } as const;

// Dónde está cada versión del logo, para recortarla del PDF en el navegador.
const SOURCES = {
  type: "array",
  description:
    "Dónde aparece cada versión del logo (principal, isotipo, horizontal, negativo, monocromo…), la mejor aparición de cada una: grande, entera y sola, sin texto ni otros elementos alrededor. El PRIMERO es siempre el logo principal, llamado \"Principal\": la versión completa, la que suele estar en la portada (primera página). Hasta 6. Vacío si el manual no muestra el logo.",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["page", "name", "x", "y", "w", "h"],
    properties: {
      page: { type: "integer", description: "Número de página del PDF, desde 1 (el orden del archivo, no el número impreso)." },
      name: { type: "string", description: "Versión, corta: \"Principal\", \"Isotipo\", \"Negativo\"…" },
      x: { type: "number", description: "Borde izquierdo de la caja, en fracción del ancho de la página (0 a 1)." },
      y: { type: "number", description: "Borde de arriba de la caja, en fracción del alto de la página (0 a 1)." },
      w: { type: "number", description: "Ancho de la caja, en fracción del ancho de la página." },
      h: { type: "number", description: "Alto de la caja, en fracción del alto de la página." },
    },
  },
} as const;

// Aplicaciones reales y ejemplos para redes, para recortarlas del PDF.
const APPLICATIONS = {
  type: "array",
  description:
    "Las aplicaciones reales de la marca que muestra el manual: mockups o fotos de papelería, tarjetas, cartelería, packaging, indumentaria, vehículos, señalética, web, y los ejemplos para redes sociales (posteos, historias, portadas). REDES: una caja por cada posteo o historia individual, aunque en el manual estén juntos en una grilla, en un celular o en una composición: la caja toma solo ese posteo (su cuadrado o rectángulo), sin los vecinos, sin el marco del celular ni la interfaz de Instagram. OTRAS APLICACIONES: una caja por pieza; si varias están en una misma foto, una caja para toda la foto. Solo la imagen, sin títulos ni textos explicativos del manual. ESTILO VISUAL (kind \"estilo\"): las muestras con las que el manual explica su estilo: fotos de ejemplo, tratamientos de imagen, set de íconos, recursos gráficos, tramas o patrones, ilustraciones y kit de interfaz (botones, separadores, cards). Una caja por muestra o por grupo que va junto (el set de íconos entero, la fila de botones entera), sin los títulos ni los párrafos del manual; en name va el tema, con las mismas palabras que en imagery (\"Fotografía\", \"Iconografía\", \"Botones\"). No repitas ahí las piezas que ya van como aplicación o redes, ni el logo, la paleta o las tipografías. Hasta 9 posteos o historias, hasta 8 otras aplicaciones y hasta 8 muestras de estilo, las más representativas y variadas. Vacío si el manual no tiene nada de esto.",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["page", "name", "kind", "x", "y", "w", "h"],
    properties: {
      page: { type: "integer", description: "Número de página del PDF, desde 1 (el orden del archivo, no el número impreso)." },
      name: { type: "string", description: "Qué es, corto: \"Tarjetas personales\", \"Posteo lanzamiento\", \"Historia promo\", \"Bolsa\"… En una muestra de estilo, el tema: \"Fotografía\", \"Iconografía\"." },
      kind: { type: "string", enum: ["redes", "aplicacion", "estilo"], description: "\"redes\" para un posteo o una historia de redes sociales (de a uno); \"estilo\" para una muestra del estilo visual; \"aplicacion\" para el resto." },
      x: { type: "number", description: "Borde izquierdo de la caja, en fracción del ancho de la página (0 a 1)." },
      y: { type: "number", description: "Borde de arriba de la caja, en fracción del alto de la página (0 a 1)." },
      w: { type: "number", description: "Ancho de la caja, en fracción del ancho de la página." },
      h: { type: "number", description: "Alto de la caja, en fracción del alto de la página." },
    },
  },
} as const;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "colors", "fonts", "logo", "voice", "imagery", "applications"],
  properties: {
    summary: { type: "string", description: "Qué es la marca y su esencia, en 2 a 4 oraciones, según el manual." },
    colors: {
      type: "array",
      description: "Todos los colores de la paleta, del más importante al menos.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "hex", "rgb", "cmyk", "pantone", "role", "usage"],
        properties: {
          name: { type: "string", description: "Nombre que le da el manual; si no tiene, uno descriptivo corto." },
          hex: { type: "string", description: "HEX de 6 dígitos con #. Si el manual no lo da, convertilo desde RGB." },
          rgb: { ...nullableString, description: 'Como lo da el manual, "R, G, B". null si no lo da.' },
          cmyk: { ...nullableString, description: 'Como lo da el manual, "C, M, Y, K". null si no lo da.' },
          pantone: { ...nullableString, description: "Código Pantone si lo da el manual." },
          role: { ...nullableString, description: "primario, secundario, acento, neutro, fondo…" },
          usage: { ...nullableString, description: "Para qué se usa, en una oración, si el manual lo dice." },
        },
      },
    },
    fonts: {
      type: "array",
      description: "Familias tipográficas de la marca (no las del documento si no son de la marca).",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["family", "role", "weights", "usage"],
        properties: {
          family: { type: "string", description: "Nombre exacto de la familia, sin pesos (p. ej. \"Montserrat\")." },
          role: { ...nullableString, description: "títulos, cuerpo, acento…" },
          weights: { ...stringList, description: "Pesos o estilos que nombra el manual (Regular, Bold, 700…)." },
          usage: { ...nullableString, description: "Cómo y dónde se usa, en una oración." },
        },
      },
    },
    logo: {
      type: "object",
      additionalProperties: false,
      required: ["description", "rules", "sources"],
      properties: {
        sources: SOURCES,
        description: { ...nullableString, description: "Cómo es el logo y sus versiones (principal, isotipo, monocromo…)." },
        rules: { ...stringList, description: "Reglas de uso: área de resguardo, tamaño mínimo, fondos permitidos y usos incorrectos." },
      },
    },
    voice: {
      type: "object",
      additionalProperties: false,
      required: ["description", "keywords", "dos", "donts"],
      properties: {
        description: { ...nullableString, description: "Tono y personalidad de la marca." },
        keywords: { ...stringList, description: "Hasta 8 palabras que definen la personalidad." },
        dos: { ...stringList, description: "Qué hacer al comunicar." },
        donts: { ...stringList, description: "Qué evitar al comunicar." },
      },
    },
    imagery: { ...stringList, description: "Lineamientos de fotografía, ilustración, íconos o gráficos." },
    applications: APPLICATIONS,
  },
} as const;

const SYSTEM = `Leés el manual de marca (brandbook) de un cliente de Qualita Studio, una agencia de branding de Argentina, y lo pasás a datos para que el equipo lo use todos los días: copiar colores, saber qué tipografía va en cada lugar, respetar el logo y el tono.

- Copiá lo que dice el manual; no inventes colores, códigos ni reglas. Si un dato no está, dejalo en null o en una lista vacía.
- Los códigos de color salen tal cual del manual. El HEX es obligatorio: si el manual solo da RGB, convertilo; si solo da CMYK o Pantone, usá la mejor aproximación.
- Las cajas de las aplicaciones se recortan como imagen: que tomen la pieza o la foto entera, sin los títulos ni los textos del manual. En redes, cada posteo o historia es una caja aparte, ajustada a su borde.
- Las cajas del logo se usan para recortarlo de la página: que lo contengan entero con un margen chico, sin textos, flechas de medidas ni otros elementos. Preferí páginas donde el logo está grande y solo.
- Todo en español rioplatense, breve y claro.`;

// Le pasa el PDF a Claude y devuelve el JSON del esquema. Hasta ~24 MB va en el
// mensaje; más pesado (base64 supera los 32 MB del pedido) pasa por la Files API
// y se borra al terminar.
async function askClaude(
  pdf: Blob,
  fileName: string,
  userId: string,
  schema: Record<string, unknown>,
  prompt: string,
  effort?: "low" | "medium" | "high",
): Promise<unknown> {
  const ai = await aiChoice("marca");
  const client = new Anthropic();
  const buffer = Buffer.from(await pdf.arrayBuffer());
  let fileId: string | null = null;

  try {
    let source: Anthropic.Messages.DocumentBlockParam["source"];
    if (buffer.length <= 24 * 1024 * 1024) {
      source = { type: "base64", media_type: "application/pdf", data: buffer.toString("base64") };
    } else {
      const uploaded = await client.files.upload({ file: await toFile(buffer, fileName, { type: "application/pdf" }) });
      fileId = uploaded.id;
      source = { type: "file", file_id: uploaded.id };
    }

    const stream = client.messages.stream({
      model: ai.model,
      max_tokens: 32000,
      system: SYSTEM,
      thinking: { type: "adaptive" },
      output_config: { effort: effort ?? ai.effort ?? "medium", format: { type: "json_schema", schema } },
      messages: [
        {
          role: "user",
          content: [
            { type: "document", source, title: fileName },
            { type: "text", text: prompt },
          ],
        },
      ],
    });
    const response = await stream.finalMessage();
    await recordUsage("marca", userId, null, ai.model, addUsage(emptyTokens(), response.usage));

    if (response.stop_reason === "refusal") throw new Error("Claude no quiso leer el manual.");
    if (response.stop_reason === "max_tokens") throw new Error("La respuesta de Claude quedó cortada.");
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") throw new Error("Claude no devolvió datos.");
    return JSON.parse(block.text);
  } finally {
    if (fileId) await client.files.delete(fileId).catch(() => {});
  }
}

const extractWithClaude = async (pdf: Blob, fileName: string, userId: string) =>
  normalizeBrand(await askClaude(pdf, fileName, userId, SCHEMA, "Pasá este manual de marca a datos."));

const friendly = (e: unknown) => {
  if (e instanceof Anthropic.BadRequestError) {
    return /page|pages|too large|size/i.test(e.message)
      ? "El PDF es demasiado grande para leerlo (más de 600 páginas o muy pesado). Probá con una versión liviana."
      : "Claude no pudo leer el PDF. Probá con otra exportación del manual.";
  }
  return e instanceof Error ? e.message : "No se pudo leer el manual.";
};

// Corre la extracción y guarda el resultado (o el error). Con service_role: quien
// la llama ya validó que el usuario es del equipo y ve al cliente.
// Devuelve las cajas de los logos y las aplicaciones que falta recortar (las ya
// recortadas de una lectura anterior se conservan, así no se duplican).
export async function extractBrandBook(
  clientId: string,
  userId: string,
): Promise<{ ok: boolean; error: string | null; sources?: LogoSource[]; applications?: BrandApplication[] }> {
  const db = createAdminClient();
  const { data: row } = await db
    .from("intranet_brand_books")
    .select("pdf_path, pdf_name, data")
    .eq("client_id", clientId)
    .maybeSingle<{ pdf_path: string | null; pdf_name: string | null; data: unknown }>();
  if (!row?.pdf_path) return { ok: false, error: "Primero subí el PDF del manual." };

  const save = (patch: Record<string, unknown>) =>
    db.from("intranet_brand_books").update({ ...patch, updated_by: userId, updated_at: new Date().toISOString() }).eq("client_id", clientId);

  await save({ status: "extrayendo", error: null });
  try {
    const { data: pdf, error } = await bucket().download(row.pdf_path);
    if (error || !pdf) throw new Error("No se encontró el PDF subido.");
    const data = await checkGoogleFonts(await extractWithClaude(pdf, row.pdf_name ?? "manual.pdf", userId));
    const before = row.data ? normalizeBrand(row.data) : null;
    // Lo elegido a mano sobre los logos subidos (principal, fondos) no sale del PDF.
    data.logo.main = before?.logo.main;
    data.logo.backgrounds = before?.logo.backgrounds;
    // Las ya recortadas con el criterio actual se conservan; las de uno anterior se rehacen.
    const current = before?.applicationsVersion === APPS_VERSION;
    const cropped = current ? (before?.applications?.filter((a) => a.path) ?? []) : [];
    if (cropped.length) {
      data.applications = cropped;
      data.applicationPages = before?.applicationPages;
      data.applicationsVersion = APPS_VERSION;
    }
    await save({ data, status: "listo", error: null, extracted_at: new Date().toISOString() });
    return { ok: true, error: null, sources: data.logo.sources ?? [], applications: cropped.length ? [] : (data.applications ?? []) };
  } catch (e) {
    console.error("[marca] extraer", clientId, e);
    const message = friendly(e);
    await save({ status: "error", error: message });
    return { ok: false, error: message };
  }
}


// Solo busca dónde está el logo, para manuales leídos antes de que existiera
// (sin volver a leer todo, que pisaría las correcciones a mano). Guarda las cajas
// en data.logo.sources.
export async function locateBrandLogos(
  clientId: string,
  userId: string,
): Promise<{ ok: true; sources: LogoSource[] } | { ok: false; error: string }> {
  const db = createAdminClient();
  const { data: row } = await db
    .from("intranet_brand_books")
    .select("pdf_path, pdf_name, data")
    .eq("client_id", clientId)
    .maybeSingle<{ pdf_path: string | null; pdf_name: string | null; data: BrandData | null }>();
  if (!row?.pdf_path) return { ok: false, error: "Primero subí el PDF del manual." };
  try {
    const { data: pdf, error } = await bucket().download(row.pdf_path);
    if (error || !pdf) throw new Error("No se encontró el PDF subido.");
    const raw = (await askClaude(
      pdf,
      row.pdf_name ?? "manual.pdf",
      userId,
      { type: "object", additionalProperties: false, required: ["sources"], properties: { sources: SOURCES } },
      "Marcá dónde está cada versión del logo en este manual.",
      "low",
    )) as { sources?: unknown };
    const sources = logoSources(raw.sources) ?? [];
    const current = row.data ? normalizeBrand(row.data) : EMPTY_BRAND;
    await db
      .from("intranet_brand_books")
      .update({ data: { ...current, logo: { ...current.logo, sources } }, updated_by: userId, updated_at: new Date().toISOString() })
      .eq("client_id", clientId);
    return { ok: true, sources };
  } catch (e) {
    console.error("[marca] logos", clientId, e);
    return { ok: false, error: friendly(e) };
  }
}

// Solo busca las aplicaciones y los ejemplos para redes (manuales leídos antes, o
// para volver a sacarlas). Reemplaza la lista; las imágenes viejas las borra
// saveBrandApplications al guardar las nuevas.
export async function locateBrandApplications(
  clientId: string,
  userId: string,
): Promise<{ ok: true; applications: BrandApplication[] } | { ok: false; error: string }> {
  const db = createAdminClient();
  const { data: row } = await db
    .from("intranet_brand_books")
    .select("pdf_path, pdf_name, data")
    .eq("client_id", clientId)
    .maybeSingle<{ pdf_path: string | null; pdf_name: string | null; data: unknown }>();
  if (!row?.pdf_path) return { ok: false, error: "Primero subí el PDF del manual." };
  // Los temas de estilo ya cargados ("Fotografía: …"), para que las muestras se
  // llamen igual y el panel las junte con su pauta.
  const topics = (row.data ? normalizeBrand(row.data).imagery : []).flatMap((t) => (t.indexOf(":") > 0 && t.indexOf(":") <= 30 ? [t.slice(0, t.indexOf(":"))] : []));
  try {
    const { data: pdf, error } = await bucket().download(row.pdf_path);
    if (error || !pdf) throw new Error("No se encontró el PDF subido.");
    const raw = (await askClaude(
      pdf,
      row.pdf_name ?? "manual.pdf",
      userId,
      { type: "object", additionalProperties: false, required: ["applications"], properties: { applications: APPLICATIONS } },
      `Marcá dónde están las aplicaciones reales de la marca, los ejemplos para redes sociales y las muestras de estilo visual en este manual.${topics.length ? ` Temas de estilo ya cargados; usalos como name de las muestras que correspondan: ${topics.join(", ")}.` : ""}`,
      "low",
    )) as { applications?: unknown };
    return { ok: true, applications: (applicationSources(raw.applications) ?? []).map((a) => ({ ...a, path: null })) };
  } catch (e) {
    console.error("[marca] aplicaciones", clientId, e);
    return { ok: false, error: friendly(e) };
  }
}

// Las aplicaciones ya recortadas, con su URL firmada (2 horas, como los recursos).
export type ApplicationMedia = {
  apps: { index: number; name: string; kind: BrandApplication["kind"]; url: string; page: number; x: number; y: number; w: number; h: number }[];
};

export async function brandApplicationMedia(data: BrandData): Promise<ApplicationMedia> {
  const list = (data.applications ?? []).map((a, index) => ({ ...a, index })).filter((a) => a.path);
  if (!list.length) return { apps: [] };
  const { data: signed } = await bucket().createSignedUrls(
    list.map((a) => a.path!),
    2 * 60 * 60,
  );
  const urlOf = new Map((signed ?? []).map((x) => [x.path, x.signedUrl]));
  return {
    apps: list.flatMap((a) => {
      const url = urlOf.get(a.path!);
      return url ? [{ index: a.index, name: a.name, kind: a.kind, url, page: a.page, x: a.x, y: a.y, w: a.w, h: a.h }] : [];
    }),
  };
}
