"use client";

import { type CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/icons";
import { RESOURCE_CATEGORIES, type ResourceCategory, type BrandColor, type LogoSource, type VoiceExample, cmykText, contrast, contrastGrade, isDark, rgbText } from "@/lib/brand-shared";
import { AssetUploader, CopyText, DeleteApplicationButton, DeleteAssetButton, MainLogoButton, Swatch } from "./brand-ui";
import { useRouter } from "next/navigation";
import { ActionButton } from "@/components/actions";
import { saveHierarchyTexts, setResourceCategory } from "./actions";
import { ApplicationsFromPdf, LogoFromPdf, extractApplications, saveApplicationsFromPdf } from "./logo-from-pdf";
import { type LogoTone, bestBackground, readability, useLogoTones } from "./logo-tone";

// Manual de marca como tablero (bento). Pedido del usuario: "más UX/UI, más
// interactivo, que no parezca un documento"; se probó también una estructura
// de app con menú lateral y eligió el tablero. Cada bloque muestra lo esencial
// sin texto (la paleta se copia ahí mismo) y abre su sección en un panel con
// pestañas para pasar de una a otra. Los tamaños se calculan según lo que tiene
// la marca para que la grilla cierre sin huecos. Lo arma brand-view.tsx (server)
// con los datos ya resueltos.

export type BoardFont = {
  family: string;
  role: string | null;
  // Para qué se usa según el manual (de ahí salen los tamaños H1, H2…).
  usage: string | null;
  // CSS font-family listo para usar (Google, @font-face o el nombre a secas).
  css: string;
  weights: [number, string][];
  download: { href: string; external: boolean; label: string } | null;
};

export type BoardFile = {
  id: string;
  name: string;
  fileName: string;
  url: string | null;
  download: string | null;
  image: boolean;
  negative: boolean;
  // Fondos que permite el manual para este logo, en su orden (data.logo.allowed;
  // vacío = el manual no los define o todavía no se buscaron: va el automático).
  backgrounds: string[];
  size: string;
  kind: "logo" | "fuente" | "otro";
  // Iconografía, tramas… (la elegida por el equipo o la que sale del nombre).
  category: ResourceCategory;
};

// Aplicación real o ejemplo para redes recortado del PDF (index: su lugar en
// data.applications, para quitarla).
export type BoardApp = {
  index: number;
  name: string;
  kind: "redes" | "aplicacion" | "estilo" | "recurso";
  category: ResourceCategory | null | undefined;
  url: string;
  path: string; page: number; x: number; y: number; w: number; h: number };

export type BoardProps = {
  clientId: string;
  clientSlug: string;
  name: string;
  internal: boolean;
  // Dónde está el logo en el PDF (undefined: todavía no se buscó).
  logoSources: LogoSource[] | undefined;
  // Id del logo principal que eligió el equipo (data.logo.main).
  mainLogo: string | null;
  applications: BoardApp[];
  // false: todavía no se buscaron en el PDF (manual leído antes); se buscan solas.
  appsSearched: boolean;
  // Hay logos a los que todavía no se les buscaron los fondos en el manual; se buscan solos.
  backgroundsPending: boolean;
  // Las aplicaciones se recortaron con un criterio de calidad anterior; se rehacen solas.
  recropPending: boolean;
  summary: string;
  colors: BrandColor[];
  fonts: BoardFont[];
  logos: BoardFile[];
  files: BoardFile[];
  logoNotes: { description: string | null; rules: string[] };
  voice: { description: string | null; keywords: string[]; dos: string[]; donts: string[]; examples?: VoiceExample[] };
  imagery: string[];
  pdf: { view: string; download: string | null; size: string } | null;
  // Textos del panel Jerarquía escritos por el equipo (data.hierarchy).
  hierarchy: { titles: string[]; text: string | null } | null;
};

type PanelId = "logo" | "colores" | "tipografia" | "jerarquia" | "tono" | "estilo" | "ejemplos" | "recursos";

const WHITE = "#FFFFFF";
const INK = "#111111";

const TITLES: Record<PanelId, string> = {
  logo: "Logo",
  colores: "Colores",
  tipografia: "Tipografía",
  jerarquia: "Jerarquía",
  tono: "Tono",
  estilo: "Estilo visual",
  ejemplos: "Aplicaciones",
  recursos: "Recursos",
};

const ICONS: Record<PanelId, IconName> = {
  logo: "image",
  colores: "grid",
  tipografia: "file-text",
  jerarquia: "list",
  tono: "chat",
  estilo: "media",
  ejemplos: "sparkles",
  recursos: "folder",
};

// Tamaño de un bloque en la grilla de 12 columnas (en el celular, de 2).
type Span = { c: number; r: number; m: number; mr: number };
const spanStyle = (s: Span, i: number) => ({ "--c": s.c, "--r": s.r, "--mc": s.m, "--mr": s.mr, "--i": i }) as CSSProperties;

// El fondo de un logo: el que permite el manual (no se elige a mano, pedido del
// usuario); si permite varios, el primero donde se lee. Si el manual no lo
// define, el primero donde se lee entre blanco, el color principal, los otros de
// la marca y casi negro, según sus colores reales; mientras no se leyeron, por el nombre.
function logoBackground(l: BoardFile | undefined, tones: Record<string, LogoTone | null>, colors: BrandColor[], primary: BrandColor | undefined) {
  const t = l?.url ? tones[l.url] : null;
  if (l?.backgrounds.length) return t && l.backgrounds.length > 1 ? bestBackground(t, l.backgrounds) : l.backgrounds[0];
  if (t) return bestBackground(t, [WHITE, ...(primary ? [primary.hex] : []), ...colors.slice(0, 5).map((c) => c.hex), INK]);
  return l?.negative ? (primary?.hex ?? INK) : WHITE;
}

// ---------- Datos del manual en corto (para los bloques del tablero) ----------

const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

// Lo que las reglas del logo dan en números: área de seguridad y tamaño mínimo.
// El área segura va con su dibujo y dicha en palabras ("1x libre alrededor", y
// qué es x si el manual lo define): "1x · Área segura" sola no se entendía.
type LogoSpec = { label: string; value: string; safe?: boolean; title?: string };
function logoSpecs(rules: string[]): LogoSpec[] {
  const out: LogoSpec[] = [];
  const safe = rules.find((r) => /([áa]rea|zona|espacio) de (seguridad|protecci[óo]n|resguardo|respeto|reserva)/i.test(r));
  const area = safe?.match(/\d+(?:[.,]\d+)?\s?(?:x|%|mm|cm|px)(?![a-záéíóú])/i)?.[0];
  const unit = safe?.match(/\bx\s*=\s*([^.;(]+)/i)?.[1].trim();
  if (area && safe)
    out.push({ label: unit && unit.length <= 40 ? `x = ${unit}` : "Área de seguridad", value: `${area.replace(/\s/g, "")} libre alrededor`, safe: true, title: safe });
  const min = rules.find((r) => /m[íi]nim/i.test(r));
  const sizes = min ? [...new Set([...min.matchAll(/\d+(?:[.,]\d+)?\s?(?:cm|mm|px|pt)\b/gi)].map((m) => m[0]))] : [];
  if (sizes.length) out.push({ label: "Tamaño mínimo", value: sizes.slice(0, 2).join(" · "), title: min });
  return out;
}

// Pautas de imagen y gráficos: el tema de cada una (lo que va antes de los dos
// puntos, o el arranque de la frase si es corto) y el resto del texto. Solo las
// primeras (`titled`) llevan título en el panel: en las otras repetiría la frase.
type StyleNote = { head: string; text: string; titled: boolean };
function styleNotes(imagery: string[]): StyleNote[] {
  return imagery.map((raw) => {
    const r = raw.trim();
    const colon = r.indexOf(":");
    if (colon > 0 && colon <= 30) return { head: r.slice(0, colon), text: capital(r.slice(colon + 1).trim()), titled: true };
    const cut = r.search(/[;,.]/);
    return { head: cut > 3 && cut <= 32 ? r.slice(0, cut) : "", text: r, titled: false };
  });
}

// Tamaños de la jerarquía que nombre el manual ("H1 32 px"), en orden.
function headingSizes(fonts: BoardFont[]): string[] {
  const text = fonts.map((f) => f.usage ?? "").join(" ");
  return [...new Set([...text.matchAll(/H([1-6])\s*:?\s*(\d+)\s*px/gi)].map((m) => `H${m[1]} ${m[2]}`))].slice(0, 4);
}

// El principal primero: el que eligió el equipo, si no el que se llama "Principal"
// (así lo nombra Claude al sacarlo del PDF), si no el primero subido.
function mainFirst(logos: BoardFile[], mainId: string | null) {
  const main = logos.find((l) => l.id === mainId) ?? logos.find((l) => /princip|main|primar/i.test(l.name)) ?? logos[0];
  return main ? [main, ...logos.filter((l) => l !== main)] : logos;
}

export function BrandBoard(props: BoardProps) {
  const p = { ...props, logos: mainFirst(props.logos, props.mainLogo) };
  const primary = p.colors.find((c) => /primar|principal/i.test(c.role ?? "")) ?? p.colors[0];
  const display = p.fonts.find((f) => /t[ií]tul|display|head/i.test(f.role ?? "")) ?? p.fonts[0];
  const body = p.fonts.find((f) => f !== display) ?? display;
  const onPrimary = primary && isDark(primary.hex) ? WHITE : INK;
  const tones = useLogoTones(p.logos.map((l) => (l.image ? l.url : null)));
  // Los ejemplos aplicados ponen el logo sobre el color principal: el que mejor se
  // lee ahí. El bloque del tablero muestra siempre el principal, sobre su fondo.
  const images = p.logos.filter((l) => l.image && l.url);
  // Solo los que el manual permite sobre el color principal (o que no tienen fondos definidos).
  const allowedOnPrimary = (l: BoardFile) => !l.backgrounds.length || l.backgrounds.some((b) => contrast(b, primary!.hex) < 1.15);
  const scored = primary ? images.filter((l) => tones[l.url!] && !tones[l.url!]!.ownBackground && allowedOnPrimary(l)) : [];
  const examplesLogo = scored.length
    ? scored.reduce((best, l) => (readability(tones[l.url!]!, primary!.hex) > readability(tones[best.url!]!, primary!.hex) ? l : best))
    : (images.find((l) => (primary ? allowedOnPrimary(l) && (isDark(primary.hex) ? l.negative : !l.negative) : !l.negative)) ??
      (primary ? images.find(allowedOnPrimary) : undefined) ??
      images[0]);
  const heroLogo = p.logos[0]?.image && p.logos[0].url ? p.logos[0] : undefined;
  const heroBg = heroLogo ? logoBackground(heroLogo, tones, p.colors, primary) : primary?.hex;
  const displayCss = display?.css;
  const hasTone = p.voice.keywords.length > 0 || !!p.voice.description || p.voice.dos.length > 0;
  // Más datos del manual en el tablero: números del logo, jerarquía, estilo y lo que no va.
  const specs = logoSpecs(p.logoNotes.rules);
  const notes = styleNotes(p.imagery);
  const sizes = headingSizes(p.fonts);
  const lead = p.summary.trim().split(/(?<=\.)\s/)[0] ?? "";
  // Color de acento para el bloque de estilo (si es casi blanco, queda neutro).
  const accent = p.colors.find((c) => c !== primary && /acent|accent|secundar/i.test(c.role ?? "")) ?? p.colors.find((c) => c !== primary);
  const accentHex = accent && contrast(accent.hex, WHITE) > 1.25 ? accent.hex : undefined;
  // Aplicada: las piezas reales del PDF; sin ellas, piezas de muestra (con color principal).
  // Las muestras de estilo (kind "estilo") van al panel Estilo visual y los
  // elementos gráficos sueltos (kind "recurso"), a Recursos; ninguno a la mesa.
  const realApps = p.applications.filter((a) => a.kind !== "estilo" && a.kind !== "recurso");
  const styleShots = p.applications.filter((a) => a.kind === "estilo");
  const resShots = p.applications.filter((a) => a.kind === "recurso");
  // Un tema del estilo visual que tiene un recurso (Huella, Iconografía, Emojis…)
  // sale entero de Estilo visual (pedido del usuario): su imagen va a Recursos y
  // su pauta se ve ahí al filtrar esa categoría.
  const allTopics = styleTopics(notes, [...styleShots, ...resShots]);
  const isRes = (t: StyleTopic) => t.shots.some((x) => x.kind === "recurso");
  const styleList = allTopics.filter((t) => !isRes(t));
  const guides: ResourceGuide[] = allTopics.filter(isRes).flatMap((t) =>
    t.notes.length ? [{ category: t.shots.find((x) => x.kind === "recurso")?.category ?? "graficos", title: t.title, text: t.notes.join(" ") }] : [],
  );
  const heads = styleList.map((t) => t.title).filter((t) => t !== "General").slice(0, 5);
  const extras = [!!display && !!(p.hierarchy?.text || lead) && "jerarquia", heads.length >= 2 && "estilo"].filter(Boolean) as string[];
  const showFiles = p.files.length > 0 || resShots.length > 0 || p.internal;
  const fileCount = p.files.length + resShots.length;
  const hasExamples = realApps.length > 0 || !!primary || (p.internal && !!p.pdf);
  // Vista previa del bloque: hasta 5 piezas en abanico, alternando aplicaciones y
  // redes, las que entran enteras a lo ancho.
  const fanKinds = [realApps.filter((a) => a.kind === "aplicacion"), realApps.filter((a) => a.kind === "redes")];
  const fanPool: BoardApp[] = [];
  for (let i = 0; fanPool.length < 7 && (fanKinds[0][i] || fanKinds[1][i]); i++) fanPool.push(...fanKinds.flatMap((k) => (k[i] ? [k[i]] : [])));
  const fanRatios = useImageRatios(fanPool.map((a) => a.url));
  const fan: BoardApp[] = [];
  let fanWidth = 0;
  for (const a of fanPool) {
    const r = fanRatios[a.url] ?? 1;
    if (fan.length >= 5) break;
    if (fan.length >= 2 && fanWidth + r > 4.3) continue;
    fan.push(a);
    fanWidth += r;
  }
  const appsPending = useAutoApplications(p.internal && !!p.pdf && !p.appsSearched, p.clientSlug);
  const recropping = useAutoRecrop(p.internal && p.appsSearched && p.recropPending ? p.pdf?.view : undefined, p.clientId, p.applications);
  // Sacar o recortar de nuevo las piezas tarda uno o dos minutos en el navegador:
  // sin aviso parecía que no pasaba nada y, al recargar, se cortaba.
  const updating = (appsPending && realApps.length > 0) || recropping;
  useAutoFetch("/api/marca/fondos", p.internal && !!p.pdf && p.backgroundsPending, p.clientSlug);
  const examplesPending = useAutoFetch("/api/marca/tono", p.internal && !!p.pdf && p.voice.examples === undefined, p.clientSlug);

  const sections: PanelId[] = [
    "logo",
    ...(p.colors.length ? (["colores"] as const) : []),
    ...(p.fonts.length ? (["tipografia"] as const) : []),
    ...(extras.includes("jerarquia") ? (["jerarquia"] as const) : []),
    ...(hasTone ? (["tono"] as const) : []),
    ...(styleList.length ? (["estilo"] as const) : []),
    ...(hasExamples ? (["ejemplos"] as const) : []),
    ...(showFiles ? (["recursos"] as const) : []),
  ];

  const [panel, setPanel] = useState<PanelId | null>(null);
  const [fontIndex, setFontIndex] = useState(0);
  const [copied, setCopied] = useState<number | null>(null);
  // Franja abierta de la paleta: la que se señala, o el color principal.
  const [stripe, setStripe] = useState<number | null>(null);
  const openStripe = stripe ?? Math.max(0, p.colors.indexOf(primary!));
  const open = (id: PanelId, font?: number) => {
    if (font !== undefined) setFontIndex(font);
    setPanel(id);
  };
  const copyHex = async (i: number, hex: string) => {
    try {
      await navigator.clipboard.writeText(hex);
      setCopied(i);
      setTimeout(() => setCopied((x) => (x === i ? null : x)), 1300);
    } catch {
      // Sin permiso de portapapeles: no pasa nada.
    }
  };

  // Composición: fila de arriba logo + paleta; al medio tipografías y tono;
  // abajo "Aplicada" ancha con el PDF y los recursos al costado.
  const fonts = p.fonts.slice(0, 2);
  const middle = fonts.length + (hasTone ? 1 : 0);
  const midC = middle ? 12 / middle : 12;
  const smalls = (p.pdf ? 1 : 0) + (showFiles ? 1 : 0);
  const S = {
    logo: { c: p.colors.length ? 7 : 12, r: 3, m: 2, mr: 3 },
    palette: { c: 5, r: 3, m: 2, mr: 2 },
    mid: { c: midC, r: 2, m: middle > 1 ? 1 : 2, mr: 2 },
    examples: { c: smalls ? 8 : 12, r: 2, m: 2, mr: 2 },
    small: { c: hasExamples ? 4 : 12 / Math.max(smalls, 1), r: hasExamples && smalls === 1 ? 2 : 1, m: 1, mr: 1 },
  } satisfies Record<string, Span>;
  // Fila de datos: se reparten el ancho; en el celular la jerarquía va entera y
  // los otros dos de a medio si están los dos.
  const extraSpan = (id: string): Span => ({ c: 12 / extras.length, r: 2, m: id === "jerarquia" || extras.filter((e) => e !== "jerarquia").length < 2 ? 2 : 1, mr: 2 });
  let order = 0;

  return (
    <>
      <div className="bb">
        <button type="button" className="bb-tile bb-logo" style={{ ...spanStyle(S.logo, order++), ...(heroBg ? { background: heroBg, color: isDark(heroBg) ? WHITE : INK } : {}) }} onClick={() => open("logo")}>
          {heroLogo ? (
            // eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage.
            <img src={heroLogo.url!} alt={p.name} />
          ) : (
            <span className="bb-wordmark" style={{ fontFamily: displayCss }}>
              {p.name}
            </span>
          )}
          {p.internal && p.pdf && !p.logos.length && (
            <span className="bb-logo-hint">
              <Icon name="sparkles" size={13} strokeWidth={2} />
              Sacar el logo del PDF
            </span>
          )}
          {specs.length > 0 ? (
            <span className="bb-logo-specs">
              {specs.map((x) => (
                <span key={x.label} className={x.safe ? "safe" : undefined} title={x.title}>
                  {x.safe && (
                    <svg viewBox="0 0 40 28" width="40" height="28" aria-hidden>
                      <rect x="1" y="1" width="38" height="26" rx="3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2.6 2.6" opacity=".55" />
                      <rect x="9" y="8" width="22" height="12" rx="2" fill="currentColor" opacity=".85" />
                    </svg>
                  )}
                  <b>{x.value}</b>
                  <small>{x.label}</small>
                </span>
              ))}
            </span>
          ) : (
            p.voice.keywords.length > 0 && <span className="bb-logo-words">{p.voice.keywords.slice(0, 3).join(" · ")}</span>
          )}
          <TileLabel icon="image">Logo</TileLabel>
        </button>

        {p.colors.length > 0 && (
          <div className="bb-tile bb-palette" style={spanStyle(S.palette, order++)}>
            <div className="bb-stripes" onMouseLeave={() => setStripe(null)}>
              {p.colors.map((c, i) => {
                const fg = isDark(c.hex) ? WHITE : INK;
                return (
                  <button
                    key={`${c.hex}-${i}`}
                    type="button"
                    className={i === openStripe ? "on" : undefined}
                    style={{ background: c.hex, color: fg }}
                    onMouseEnter={() => setStripe(i)}
                    onFocus={() => setStripe(i)}
                    onBlur={() => setStripe(null)}
                    onClick={() => copyHex(i, c.hex)}
                    aria-label={`Copiar ${c.hex} (${c.name}${c.role ? `, ${c.role}` : ""})`}
                  >
                    <span className="bb-stripe-txt">
                      {c.role && <small>{c.role.charAt(0).toUpperCase() + c.role.slice(1)}</small>}
                      <b>{copied === i ? "Copiado" : c.name}</b>
                      <em>{c.hex}</em>
                    </span>
                  </button>
                );
              })}
            </div>
            <button type="button" className="bb-open" onClick={() => open("colores")}>
              <Icon name="grid" size={13} strokeWidth={2} />
              Colores
              <Icon name="arrow-out" size={12} strokeWidth={2.2} />
            </button>
          </div>
        )}

        {fonts.map((f, i) => (
          <button key={f.family} type="button" className="bb-tile bb-font" style={spanStyle(S.mid, order++)} onClick={() => open("tipografia", i)}>
            <span className="bb-aa" style={{ fontFamily: f.css }}>
              Aa
            </span>
            <span className="bb-font-name" style={{ fontFamily: f.css }}>
              {f.family}
            </span>
            {f.weights.length > 1 && (
              <span className="bb-font-weights" style={{ fontFamily: f.css }}>
                {f.weights.slice(0, 4).map(([w, label]) => (
                  <span key={w} style={{ fontWeight: w }}>
                    {label}
                  </span>
                ))}
              </span>
            )}
            <TileLabel icon="file-text">{f.role ?? "Tipografía"}</TileLabel>
          </button>
        ))}

        {hasTone && (
          <button type="button" className="bb-tile bb-tone" style={spanStyle(S.mid, order++)} onClick={() => open("tono")}>
            <span className="bb-words" style={{ fontFamily: displayCss }}>
              {(p.voice.keywords.length ? p.voice.keywords : ["Tono de voz"]).slice(0, 5).map((k, i) => (
                <span key={k} style={{ "--w": i } as CSSProperties}>
                  {k}
                </span>
              ))}
            </span>
            <TileLabel icon="chat" onDark>
              Tono
            </TileLabel>
          </button>
        )}

        {extras.includes("jerarquia") && (
          <button type="button" className="bb-tile bb-spec" style={spanStyle(extraSpan("jerarquia"), order++)} onClick={() => open("jerarquia")}>
            <span className="bb-spec-h" style={{ fontFamily: displayCss }}>
              {p.hierarchy?.titles[0] || p.name}
            </span>
            <span className="bb-spec-p" style={{ fontFamily: body?.css }}>
              {p.hierarchy?.text || lead}
            </span>
            <span className="bb-spec-tags">{(sizes.length ? sizes : [display?.family, body !== display ? body?.family : null]).filter(Boolean).join("  ·  ")}</span>
            <TileLabel icon="list">Jerarquía</TileLabel>
          </button>
        )}

        {extras.includes("estilo") && (
          <button
            type="button"
            className="bb-tile bb-style"
            style={{ ...spanStyle(extraSpan("estilo"), order++), ...(accentHex ? { background: accentHex, color: isDark(accentHex) ? WHITE : INK } : {}) }}
            onClick={() => open("estilo")}
          >
            <span className="bb-style-list" style={{ fontFamily: displayCss }}>
              {heads.map((h) => (
                <span key={h}>{h}</span>
              ))}
            </span>
            <TileLabel icon="media">Estilo visual</TileLabel>
          </button>
        )}

        {realApps.length > 0 ? (
          <button
            type="button"
            className="bb-tile bb-examples bb-real"
            style={{ ...spanStyle(S.examples, order++), ...(primary ? ({ "--tint": primary.hex } as CSSProperties) : {}) }}
            onClick={() => open("ejemplos")}
          >
            <span
              className="bb-real-fan"
              style={{ "--sum": fanWidth, "--sum3": fan.slice(0, 3).reduce((s, a) => s + (fanRatios[a.url] ?? 1), 0) } as CSSProperties}
            >
              {fan.map((a) => (
                // eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage.
                <img key={a.index} src={a.url} alt="" loading="lazy" />
              ))}
            </span>
            <span className="bb-real-count">
              {realApps.length} {realApps.length === 1 ? "pieza" : "piezas"}
            </span>
            <TileLabel icon="sparkles">Aplicaciones</TileLabel>
          </button>
        ) : primary ? (
          <button type="button" className="bb-tile bb-examples" style={spanStyle(S.examples, order++)} onClick={() => open("ejemplos")}>
            <span className="bb-mini">
              <span className="bb-mini-post" style={{ background: primary.hex, color: onPrimary }}>
                <span style={{ fontFamily: displayCss }}>{p.voice.keywords[0] ?? p.name}</span>
                <span className="bb-mini-cta" style={{ background: p.colors[1]?.hex ?? onPrimary, color: isDark(p.colors[1]?.hex ?? onPrimary) ? WHITE : INK, fontFamily: body?.css }}>
                  Conocé más
                </span>
              </span>
              <span className="bb-mini-card" style={{ fontFamily: body?.css }}>
                <b style={{ fontFamily: displayCss, color: primary.hex === WHITE ? INK : primary.hex }}>{p.name}</b>
                <span>Nombre Apellido</span>
                <span className="bb-mini-line" style={{ background: p.colors[1]?.hex ?? primary.hex }} />
              </span>
              <span className="bb-mini-btns" style={{ fontFamily: body?.css }}>
                <span style={{ background: primary.hex, color: onPrimary }}>Contactanos</span>
                <span style={{ borderColor: primary.hex, color: primary.hex === WHITE ? INK : primary.hex }}>Ver más</span>
              </span>
            </span>
            <TileLabel icon="sparkles">Aplicaciones</TileLabel>
          </button>
        ) : (
          hasExamples && (
            <button type="button" className="bb-tile bb-examples" style={spanStyle(S.examples, order++)} onClick={() => open("ejemplos")}>
              <span className="bb-logo-hint">
                <Icon name="sparkles" size={13} strokeWidth={2} />
                {appsPending ? "Sacando las aplicaciones del PDF…" : "Sin aplicaciones en el manual"}
              </span>
              <TileLabel icon="sparkles">Aplicaciones</TileLabel>
            </button>
          )
        )}

        {p.pdf && (
          <a className="bb-tile bb-small" style={spanStyle(S.small, order++)} href={p.pdf.view} target="_blank" rel="noopener noreferrer">
            <span className="bb-small-ico">
              <Icon name="doc" size={20} />
            </span>
            <span className="bb-small-txt">
              <b>Manual completo</b>
              <small>PDF · {p.pdf.size}</small>
            </span>
            <Icon name="arrow-out" size={16} className="bb-small-go" />
          </a>
        )}

        {showFiles && (
          <button type="button" className="bb-tile bb-small" style={spanStyle(S.small, order++)} onClick={() => open("recursos")}>
            <span className="bb-small-ico">
              <Icon name="folder" size={20} />
            </span>
            <span className="bb-small-txt">
              <b>Recursos</b>
              <small>{fileCount ? `${fileCount} ${fileCount === 1 ? "archivo" : "archivos"}` : "Sin archivos"}</small>
            </span>
            <Icon name="chevron" size={16} className="bb-small-go" />
          </button>
        )}
      </div>

      {updating && (
        <div className="bb-updating" role="status">
          <span className="bb-updating-dot" aria-hidden />
          <span>
            <b>Actualizando las piezas del manual…</b>
            Tarda uno o dos minutos. No cierres ni recargues la página.
          </span>
        </div>
      )}

      {panel && (
        <Sheet sections={sections} current={panel} onPick={setPanel} onClose={() => setPanel(null)}>
          {panel === "colores" && <ColorsPanel colors={p.colors} />}
          {panel === "tipografia" && <TypePanel key={fontIndex} fonts={p.fonts} initial={fontIndex} />}
          {panel === "logo" && <LogoPanel {...p} primary={primary} displayCss={displayCss} tones={tones} />}
          {panel === "tono" && <TonePanel voice={p.voice} summary={p.summary} displayCss={displayCss} examplesPending={examplesPending} />}
          {panel === "jerarquia" && display && (
            <HierarchyPanel
              name={p.name}
              display={display}
              body={body ?? display}
              sizes={sizes}
              keywords={p.voice.keywords}
              lead={lead}
              saved={p.hierarchy}
              internal={p.internal}
              clientId={p.clientId}
              primary={primary?.hex ?? null}
            />
          )}
          {panel === "estilo" && (
            <StylePanel
              topics={styleList}
              pieces={realApps}
              accent={accentHex ?? primary?.hex}
              tint={primary?.hex}
              displayCss={display?.css}
              pending={appsPending}
              clientId={p.clientId}
              internal={p.internal}
            />
          )}
          {panel === "ejemplos" && (
            <>
              <RealAppsPanel apps={realApps} tint={primary?.hex} clientId={p.clientId} clientSlug={p.clientSlug} internal={p.internal} pdf={!!p.pdf} />
              {!realApps.length && primary && <ExamplesPanel {...p} primary={primary} display={display} body={body} logo={examplesLogo} />}
            </>
          )}
          {panel === "recursos" && <FilesPanel clientId={p.clientId} files={p.files} extracted={resShots} guides={guides} internal={p.internal} />}
        </Sheet>
      )}
    </>
  );
}

// Manuales leídos antes de que se sacaran las aplicaciones: el equipo las saca
// solo al abrir el tablero (una vez por carga de página y cliente: `autoApps`
// evita repetirla, también con el doble efecto de desarrollo). Devuelve si está corriendo.
const autoApps = new Map<string, Promise<string | null>>();

// Datos que se buscan solos en el manual la primera vez que el equipo abre el
// tablero (los fondos permitidos de logos nuevos, los ejemplos de tono de un
// manual leído antes): una vez por carga de página, cliente y ruta, y la
// pantalla se refresca con el resultado. Devuelve si está corriendo.
const autoFetched = new Set<string>();

function useAutoFetch(endpoint: string, enabled: boolean, clientSlug: string) {
  const router = useRouter();
  const [done, setDone] = useState(false);
  useEffect(() => {
    const key = `${endpoint}:${clientSlug}`;
    if (!enabled || autoFetched.has(key)) return;
    autoFetched.add(key);
    void fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client: clientSlug }),
    })
      .then((r) => r.json())
      .then((r: { ok: boolean; error?: string }) => {
        if (!r.ok) console.warn("[marca]", endpoint, r.error);
        router.refresh();
      })
      .catch(() => {})
      .finally(() => setDone(true));
  }, [endpoint, enabled, clientSlug, router]);
  return enabled && !done;
}

// Imágenes recortadas con una calidad anterior (CROP_VERSION): se vuelven a
// recortar con las mismas cajas, sin pasar por Claude, una vez por carga de
// página y cliente, y la pantalla se refresca con las nuevas.
const autoRecrop = new Set<string>();

function useAutoRecrop(pdfUrl: string | undefined, clientId: string, apps: BoardApp[]) {
  const router = useRouter();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!pdfUrl || autoRecrop.has(clientId)) return;
    autoRecrop.add(clientId);
    const boxes = apps.map(({ name, kind, category, path, page, x, y, w, h }) => ({ name, kind, category, path, page, x, y, w, h }));
    void saveApplicationsFromPdf(clientId, pdfUrl, boxes, true)
      .then((error) => {
        if (error) console.warn("[marca] recortar de nuevo", error);
        router.refresh();
      })
      .catch(() => {})
      .finally(() => setDone(true));
  }, [pdfUrl, clientId, apps, router]);
  return !!pdfUrl && !done;
}

function useAutoApplications(enabled: boolean, clientSlug: string) {
  const router = useRouter();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const first = !autoApps.has(clientSlug);
    if (first) autoApps.set(clientSlug, extractApplications(clientSlug));
    void autoApps.get(clientSlug)!.then((error) => {
      if (first) {
        if (error) console.warn("[marca] aplicaciones", error);
        router.refresh();
      }
      if (alive) setDone(true);
    });
    return () => {
      alive = false;
    };
  }, [enabled, clientSlug, router]);
  return enabled && !done;
}

function TileLabel({ icon, children, onDark }: { icon: IconName; children: React.ReactNode; onDark?: boolean }) {
  return (
    <span className={`bb-label${onDark ? " on-dark" : ""}`}>
      <Icon name={icon} size={13} strokeWidth={2} />
      {children}
      <Icon name="arrow-out" size={12} strokeWidth={2.2} className="bb-label-go" />
    </span>
  );
}

// Panel encima del tablero (dialog nativo: Escape, foco atrapado), con pestañas
// para pasar de una sección a otra sin cerrarlo; también con ← y →.
function Sheet({
  sections,
  current,
  onPick,
  onClose,
  children,
}: {
  sections: PanelId[];
  current: PanelId;
  onPick: (id: PanelId) => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
  }, [current]);

  const step = (dir: 1 | -1) => {
    const i = sections.indexOf(current);
    onPick(sections[(i + dir + sections.length) % sections.length]);
  };

  return (
    <dialog
      ref={ref}
      className="modal bb-sheet"
      aria-label={TITLES[current]}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) ref.current?.close();
      }}
      onKeyDown={(e) => {
        const el = e.target as HTMLElement;
        if (el.closest("input, textarea, select, [contenteditable]")) return;
        if (e.key === "ArrowRight") step(1);
        if (e.key === "ArrowLeft") step(-1);
      }}
    >
      <div className="bb-sheet-card">
        <div className="bb-sheet-head">
          <nav className="bb-sheet-tabs" aria-label="Secciones del manual">
            {sections.map((id) => (
              <button key={id} type="button" className={id === current ? "on" : undefined} aria-current={id === current ? "page" : undefined} onClick={() => onPick(id)}>
                <Icon name={ICONS[id]} size={15} strokeWidth={2} />
                <span>{TITLES[id]}</span>
              </button>
            ))}
          </nav>
          <button type="button" className="modal-close" onClick={() => ref.current?.close()} aria-label="Cerrar">
            ×
          </button>
        </div>
        <div className="bb-sheet-body" ref={body}>
          <div key={current} className="bb-sheet-section">
            {children}
          </div>
        </div>
      </div>
    </dialog>
  );
}

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: React.ReactNode; title?: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="bb-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? "on" : undefined}
          onClick={() => onChange(o.value)}
          title={o.title}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Colores ----------

function ColorsPanel({ colors }: { colors: BrandColor[] }) {
  // Cada color de la marca como fondo, con los demás (más blanco y negro) como texto.
  const pairs = useMemo(() => {
    // Sin colores repetidos (p. ej. un blanco de la marca igual al blanco).
    const unique = (list: { name: string; hex: string }[]) => [...new Map(list.map((c) => [c.hex.toUpperCase(), c])).values()];
    const inks = unique([...colors.map((c) => ({ name: c.name, hex: c.hex })), { name: "Blanco", hex: WHITE }, { name: "Negro", hex: INK }]);
    const backgrounds = unique([...colors.map((c) => ({ name: c.name, hex: c.hex })), { name: "Blanco", hex: WHITE }]);
    return backgrounds
      .flatMap((bg) => inks.filter((fg) => fg.hex.toUpperCase() !== bg.hex.toUpperCase()).map((fg) => ({ bg, fg, ratio: contrast(bg.hex, fg.hex) })))
      .sort((a, b) => b.ratio - a.ratio);
  }, [colors]);
  // Correctas: contraste 4,5+ (texto normal, WCAG AA); el resto, a evitar.
  const good = pairs.filter((x) => x.ratio >= 4.5);
  // A sobre B y B sobre A tienen el mismo contraste: en las incorrectas va una sola.
  const seen = new Set<string>();
  const bad = pairs
    .filter((x) => x.ratio < 4.5)
    .reverse()
    .filter(({ bg, fg }) => {
      const key = [bg.hex, fg.hex].map((h) => h.toUpperCase()).sort().join();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const pairList = (list: typeof pairs) => (
    <div className="bb-pairs">
      {list.map(({ bg, fg, ratio }) => {
        const grade = contrastGrade(ratio);
        return (
          <div key={`${bg.hex}-${fg.hex}`} className="bb-pair" style={{ background: bg.hex, color: fg.hex }} title={`${fg.name} sobre ${bg.name}`}>
            <span className="bb-pair-aa">Aa</span>
            <span className={`bb-grade${ratio < 4.5 ? " bad" : ""}`}>
              {grade} · {ratio.toFixed(1).replace(".", ",")}
            </span>
          </div>
        );
      })}
    </div>
  );

  return (
    <>
      <div className="bb-swatches">
        {colors.map((c, i) => (
          <Swatch
            key={`${c.hex}-${i}`}
            name={c.name}
            hex={c.hex}
            role={c.role ?? null}
            dark={isDark(c.hex)}
            big={false}
            codes={[
              { label: "RGB", value: c.rgb ?? rgbText(c.hex) },
              { label: "CMYK", value: c.cmyk ?? cmykText(c.hex) },
              ...(c.pantone ? [{ label: "Pantone", value: c.pantone }] : []),
            ]}
          />
        ))}
      </div>

      <div className="bb-block-head">
        <h3>Combinaciones correctas</h3>
        <span className="bb-hint">Se leen bien: contraste 4,5 o más</span>
      </div>
      {good.length ? pairList(good) : <p className="bb-hint">Ninguna combinación llega al contraste mínimo para texto.</p>}

      {bad.length > 0 && (
        <>
          <div className="bb-block-head">
            <h3>Combinaciones incorrectas</h3>
            <span className="bb-hint">No usar para texto: no se leen bien</span>
          </div>
          {pairList(bad)}
        </>
      )}
    </>
  );
}

// ---------- Tipografía ----------

function TypePanel({ fonts, initial }: { fonts: BoardFont[]; initial: number }) {
  const [index, setIndex] = useState(initial);
  const font = fonts[index] ?? fonts[0];
  const [text, setText] = useState("Escribí acá para probar la tipografía");
  const [size, setSize] = useState(56);
  const [weight, setWeight] = useState(font.weights.find(([w]) => w === 400)?.[0] ?? font.weights[0]?.[0] ?? 400);

  const pick = (i: number) => {
    setIndex(i);
    const ws = fonts[i].weights;
    if (!ws.some(([w]) => w === weight)) setWeight(ws.find(([w]) => w === 400)?.[0] ?? ws[0]?.[0] ?? 400);
  };

  return (
    <>
      {fonts.length > 1 && (
        <Segmented label="Tipografía" value={index} onChange={pick} options={fonts.map((f, i) => ({ value: i, label: f.family }))} />
      )}
      <div className="bb-tester">
        <textarea
          className="bb-tester-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{ fontFamily: font.css, fontSize: size, fontWeight: weight }}
          rows={2}
          spellCheck={false}
          aria-label="Texto de prueba"
        />
        <div className="bb-tester-controls">
          <label className="bb-range">
            <span>Tamaño</span>
            <input type="range" min={14} max={140} value={size} onChange={(e) => setSize(Number(e.target.value))} />
            <b>{size}px</b>
          </label>
          {font.weights.length > 1 && (
            <Segmented
              label="Peso"
              value={weight}
              onChange={setWeight}
              options={font.weights.map(([w, name]) => ({ value: w, label: <span style={{ fontWeight: w }}>{name}</span> }))}
            />
          )}
        </div>
      </div>
      <div className="bb-glyphs" style={{ fontFamily: font.css, fontWeight: weight }}>
        <span>ABCDEFGHIJKLMNÑOPQRSTUVWXYZ</span>
        <span>abcdefghijklmnñopqrstuvwxyz</span>
        <span>0123456789 ¿?¡!&@%$</span>
      </div>
      <div className="bb-actions">
        <CopyText value={font.family}>Copiar nombre</CopyText>
        <CopyText value={`font-family: "${font.family}";`}>Copiar CSS</CopyText>
        {font.download && (
          <a className="bh-link" href={font.download.href} {...(font.download.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
            <Icon name={font.download.external ? "arrow-out" : "download"} size={13} strokeWidth={2} />
            {font.download.label}
          </a>
        )}
      </div>
    </>
  );
}

// ---------- Logo ----------

// Mosaico del panel del logo (el primer bento, el que eligió el usuario), sin
// huecos en 12 columnas: principal 7×4; a su derecha una variante 5×2 (5×4 si es
// la única) y debajo dos (3 + 2) o una (5); las que sobran, de a dos por fila
// (6×2; la última sola, 12). Las variantes de una misma familia (primera palabra:
// "Monocromo negro" y "Monocromo blanco") van al final, así caen en filas de dos
// del mismo tamaño. El "iso…" (isologotipo / isotipo) va más chico en su bloque.
type LogoCell = { logo: BoardFile; c: number; r: number; mc: number; mr: number };

const family = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/\s+/)[0];

const isIso = (l: BoardFile) => family(l.name).startsWith("iso");

function logoLayout(logos: BoardFile[]): LogoCell[] {
  const [main, ...rest] = logos;
  if (!main) return [];
  const count = new Map<string, number>();
  for (const l of rest) count.set(family(l.name), (count.get(family(l.name)) ?? 0) + 1);
  const single = (l: BoardFile) => count.get(family(l.name)) === 1;
  const variants = [...rest.filter(single), ...rest.filter((l) => !single(l))];
  // El "iso…" va en el lugar del "con descriptor" y viceversa (pedido del usuario).
  const [iso, desc] = [variants.findIndex(isIso), variants.findIndex((l) => /descri/i.test(l.name))];
  if (iso >= 0 && desc >= 0) [variants[iso], variants[desc]] = [variants[desc], variants[iso]];
  const n = logos.length;

  const spans: Omit<LogoCell, "logo">[] = [];
  if (n === 1) spans.push({ c: 12, r: 4, mc: 2, mr: 3 });
  else {
    spans.push({ c: 7, r: 4, mc: 2, mr: 3 });
    spans.push({ c: 5, r: n === 2 ? 4 : 2, mc: n === 2 ? 2 : 1, mr: 2 });
    if (n === 3) spans.push({ c: 5, r: 2, mc: 1, mr: 2 });
    if (n >= 4) spans.push({ c: 3, r: 2, mc: 1, mr: 2 }, { c: 2, r: 2, mc: 1, mr: 2 });
    const extra = Math.max(0, n - 4);
    for (let k = 0; k < extra; k++) {
      const lastAlone = extra % 2 === 1 && k === extra - 1;
      spans.push({ c: lastAlone ? 12 : 6, r: 2, mc: lastAlone ? 2 : 1, mr: 2 });
    }
  }
  return [main, ...variants].map((logo, i) => ({ logo, ...spans[i] }));
}

function LogoPanel({
  logos,
  colors,
  name,
  logoNotes,
  internal,
  clientId,
  clientSlug,
  logoSources,
  pdf,
  primary,
  displayCss,
  tones,
}: BoardProps & { primary: BrandColor | undefined; displayCss: string | undefined; tones: Record<string, LogoTone | null> }) {
  // Mosaico bento (logoLayout): el principal (logos[0]) grande y las variantes
  // alrededor, cada una sobre el fondo que le da el manual.
  const cells = logoLayout(logos);

  return (
    <>
      {logos.length ? (
        <div className="bb-logo-bento">
          {cells.map((s, i) => {
            const l = s.logo;
            const bg = logoBackground(l, tones, colors, primary);
            const ext = l.fileName.split(".").pop()?.toUpperCase();
            return (
              <figure
                key={l.id}
                className={`bb-logo-cell${i === 0 ? " main" : ""}${i > 0 && isIso(s.logo) ? " small" : ""}`}
                style={{ background: bg, color: isDark(bg) ? WHITE : INK, ...({ "--c": s.c, "--r": s.r, "--mc": s.mc, "--mr": s.mr, "--i": i } as CSSProperties) }}
              >
                {l.image && l.url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage.
                  <img src={l.url} alt={l.name} />
                ) : (
                  <span className="bb-stage-file">{ext}</span>
                )}
                <figcaption>
                  {l.name}
                  {i === 0 && logos.length > 1 && <small>Principal</small>}
                </figcaption>
                {l.download && (
                  <a className="bb-logo-dl" href={l.download} aria-label={`Descargar ${l.name} (${ext})`} title={`Descargar ${ext}`}>
                    <Icon name="download" size={15} strokeWidth={2} />
                  </a>
                )}
                {internal && (
                  <div className="bb-logo-tools">
                    {i > 0 && <MainLogoButton clientId={clientId} id={l.id} />}
                    <DeleteAssetButton clientId={clientId} id={l.id} name={l.name} />
                  </div>
                )}
              </figure>
            );
          })}
        </div>
      ) : (
        <div className="bb-stage" style={{ background: primary?.hex ?? WHITE, color: primary && isDark(primary.hex) ? WHITE : INK }}>
          <span className="bb-wordmark" style={{ fontFamily: displayCss }}>
            {name}
          </span>
        </div>
      )}

      {internal && pdf && !logos.length && (
        <div className="bb-from-pdf">
          <span>
            <b>{logoSources?.length ? `Hay ${logoSources.length === 1 ? "un logo" : `${logoSources.length} logos`} en el PDF` : "Sin logos subidos"}</b>
            Recortalo directo del manual, sin buscar el archivo.
          </span>
          <LogoFromPdf clientId={clientId} clientSlug={clientSlug} pdfUrl={pdf.view} sources={logoSources} label="Sacar logos del PDF" />
        </div>
      )}

      {internal && (
        <div className="bb-actions">
          {pdf && logos.length > 0 && <LogoFromPdf clientId={clientId} clientSlug={clientSlug} pdfUrl={pdf.view} sources={logoSources} />}
          <AssetUploader clientId={clientId} kind="logo" label="Subir logos" />
        </div>
      )}

      {(logoNotes.rules.length > 0 || !!logoNotes.description) && <LogoRules rules={logoNotes.rules} description={logoNotes.description} />}
    </>
  );
}

// ---------- Reglas de uso del logo ----------

// Las reglas del manual en un acordeón por tipo (elegido por el usuario entre
// varias opciones; antes eran solapas y antes una lista plegada con mucho texto).
// Se abre un tipo por vez y adentro van bullets cortos: medidas con sus números,
// lo que no se hace sin el "No", fondos y otros usos con su título, y las
// versiones (la descripción, de a una oración).
type RuleGroup = "medidas" | "fondos" | "no" | "usos" | "versiones";
const RULE_GROUPS: { id: RuleGroup; label: string }[] = [
  { id: "medidas", label: "Medidas" },
  { id: "no", label: "No hacer" },
  { id: "fondos", label: "Fondos y color" },
  { id: "usos", label: "Otros usos" },
  { id: "versiones", label: "Versiones" },
];

const cleanRule = (t: string) => capital(t.trim().replace(/\.$/, ""));

function ruleGroup(r: string): Exclude<RuleGroup, "versiones"> {
  if (/^(no|nunca|evitar)\b/i.test(r.trim())) return "no";
  if (/([áa]rea|zona|espacio) de (seguridad|protecci[óo]n|resguardo|respeto|reserva)|m[íi]nim|tama[ñn]o/i.test(r)) return "medidas";
  if (/fondo|negativ|positiv|\bcolor|monocrom/i.test(r)) return "fondos";
  return "usos";
}

// "Área de resguardo: dejar libre…" → título y texto; sin dos puntos, solo texto.
function splitRule(r: string) {
  const i = r.indexOf(":");
  return i > 0 && i <= 60 ? { head: r.slice(0, i).trim(), text: cleanRule(r.slice(i + 1)) } : { head: "", text: cleanRule(r) };
}

// Los números de una medida ("1x", "3,5 cm", "220 px"), sin repetir.
const measures = (r: string) =>
  [...new Set([...r.matchAll(/\d+(?:[.,]\d+)?\s?(?:x|cm|mm|px|pt|%)(?![a-záéíóú])/gi)].map((m) => m[0].replace(/\s+/, " ")))].slice(0, 4);

// "No estirar ni deformar el logo; no debe…" → "Estirar o deformar el logo".
const forbidden = (r: string) =>
  cleanRule(
    r
      .replace(/^(no|nunca|evitar)\s+/i, "")
      .split(";")[0]
      .replace(/\bni\b/gi, "o"),
  );

function RuleItem({ group, rule }: { group: RuleGroup; rule: string }) {
  if (group === "no")
    return (
      <li className="no" title={rule}>
        <Icon name="close" size={12} strokeWidth={2.6} />
        <span>{forbidden(rule)}</span>
      </li>
    );
  const { head, text } = splitRule(rule);
  if (group === "medidas") {
    const nums = measures(rule);
    return (
      <li title={rule}>
        <Icon name="expand" size={12} strokeWidth={2.2} />
        <span>
          <b>{head || (/m[íi]nim|tama/i.test(rule) ? "Tamaño mínimo" : "Área de seguridad")}</b>
          {nums.length ? (
            <span className="bb-rule-nums">
              {nums.map((n) => (
                <em key={n}>{n}</em>
              ))}
            </span>
          ) : (
            <small>{text}</small>
          )}
        </span>
      </li>
    );
  }
  return (
    <li>
      <Icon name={group === "versiones" ? "image" : "check"} size={12} strokeWidth={2.4} />
      <span>
        {head && <b>{head}</b>}
        {head ? <small>{text}</small> : text}
      </span>
    </li>
  );
}

function LogoRules({ rules, description }: { rules: string[]; description: string | null }) {
  const groups: Record<RuleGroup, string[]> = { medidas: [], fondos: [], no: [], usos: [], versiones: [] };
  for (const r of rules) groups[ruleGroup(r)].push(r);
  groups.versiones = (description ?? "")
    .split(/(?<=\.)\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const shown = RULE_GROUPS.filter((g) => groups[g.id].length);
  // Uno abierto por vez: arranca el primero; tocar el abierto lo cierra.
  const [open, setOpen] = useState<RuleGroup | null>(shown[0]?.id ?? null);
  // Al cambiar de tipo se cierra el de arriba y todo se corría (el panel "pegaba
  // saltos"): se guarda dónde estaba el encabezado tocado y, ya dibujado, se
  // corrige el scroll del panel para que quede en el mismo lugar.
  const anchor = useRef<{ el: HTMLElement; top: number } | null>(null);
  useLayoutEffect(() => {
    const a = anchor.current;
    anchor.current = null;
    if (!a) return;
    const delta = a.el.getBoundingClientRect().top - a.top;
    const scroller = a.el.closest(".bb-sheet-body");
    if (delta && scroller) scroller.scrollTop += delta;
  }, [open]);
  if (!shown.length) return null;

  return (
    <section className="bb-rules">
      <h4>Reglas de uso</h4>
      <div className="bb-rules-acc">
        {shown.map((g) => {
          const isOpen = open === g.id;
          const panelId = `bb-rules-${g.id}`;
          return (
            <div key={g.id} className={`bb-rules-row${isOpen ? " open" : ""}`}>
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={(e) => {
                  anchor.current = { el: e.currentTarget, top: e.currentTarget.getBoundingClientRect().top };
                  setOpen(isOpen ? null : g.id);
                }}
              >
                <Icon name="chevron" size={14} strokeWidth={2.2} className="bb-rules-chev" />
                <span>{g.label}</span>
                <em>{groups[g.id].length}</em>
              </button>
              {isOpen && (
                <ul id={panelId} className={`bb-rules-items${g.id === "no" ? " no" : ""}`}>
                  {groups[g.id].map((r, i) => (
                    <RuleItem key={i} group={g.id} rule={r} />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---------- Tono ----------

// Pedido del usuario: "mucho texto", con ejemplos de cómo hablar de la marca.
// Arriba las palabras de la personalidad; después "Así habla" (una situación por
// vez: la frase como la diría la marca y cómo no decirla) y el sí / no en
// bullets cortos. La descripción queda como bajada chica.
function TonePanel({
  voice,
  summary,
  displayCss,
  examplesPending,
}: {
  voice: BoardProps["voice"];
  summary: string;
  displayCss: string | undefined;
  examplesPending: boolean;
}) {
  const examples = voice.examples ?? [];
  const [pick, setPick] = useState(0);
  const ex = examples[Math.min(pick, examples.length - 1)];

  return (
    <>
      {voice.keywords.length > 0 && (
        <div className="bb-keywords" style={{ fontFamily: displayCss }}>
          {voice.keywords.map((k) => (
            <span key={k}>{k}</span>
          ))}
        </div>
      )}
      {(voice.description || summary) && <p className="bb-tone-lead">{voice.description ?? summary}</p>}

      {ex ? (
        <section className="bb-voice">
          <div className="bb-voice-head">
            <h4>Así habla la marca</h4>
            <div className="bb-voice-tabs" role="tablist" aria-label="Situaciones">
              {examples.map((e, i) => (
                <button key={i} type="button" role="tab" aria-selected={e === ex} className={e === ex ? "on" : ""} onClick={() => setPick(i)}>
                  {e.context}
                </button>
              ))}
            </div>
          </div>
          <figure key={pick} className="bb-voice-card">
            <span className="bb-voice-badge">{ex.manual ? "Del manual" : "Sugerido según el tono"}</span>
            <blockquote style={{ fontFamily: displayCss }}>{ex.good}</blockquote>
            <div className="bb-voice-foot">
              {ex.bad && (
                <p className="bb-voice-bad">
                  <Icon name="close" size={12} strokeWidth={2.6} />
                  <span>
                    <b>Así no:</b> {ex.bad}
                  </span>
                </p>
              )}
              <CopyText value={ex.good}>Copiar frase</CopyText>
            </div>
          </figure>
        </section>
      ) : (
        examplesPending && <p className="bb-voice-wait">Armando ejemplos de cómo habla la marca…</p>
      )}

      {(voice.dos.length > 0 || voice.donts.length > 0) && (
        <div className="bb-dodont">
          {voice.dos.length > 0 && (
            <div>
              <h3 className="ok">
                <Icon name="check" size={15} strokeWidth={2.4} /> Sí
              </h3>
              <ul>
                {voice.dos.map((d, i) => (
                  <li key={i}>
                    <Icon name="check" size={12} strokeWidth={2.6} />
                    <span>{d}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {voice.donts.length > 0 && (
            <div>
              <h3 className="no">
                <Icon name="close" size={15} strokeWidth={2.4} /> No
              </h3>
              <ul>
                {voice.donts.map((d, i) => (
                  <li key={i} className="no">
                    <Icon name="close" size={12} strokeWidth={2.6} />
                    <span>{d}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ---------- Jerarquía ----------

// La escala tipográfica a tamaño real: los títulos que nombra el manual (H1 32 px…)
// en la tipografía de títulos y el texto en la de cuerpo, con textos de la marca.
// Si el manual no da tamaños, una escala de referencia sin medidas. El equipo
// puede reemplazar los textos (pedido del usuario): se editan en el lugar, con la
// misma tipografía y tamaño, y se guardan en data.hierarchy.
function HierarchyPanel({
  name,
  display,
  body,
  sizes,
  keywords,
  lead,
  saved,
  internal,
  clientId,
  primary,
}: {
  name: string;
  display: BoardFont;
  body: BoardFont;
  sizes: string[];
  keywords: string[];
  lead: string;
  saved: { titles: string[]; text: string | null } | null;
  internal: boolean;
  clientId: string;
  primary: string | null;
}) {
  const router = useRouter();
  const auto = [name, keywords.length ? capital(keywords.slice(0, 3).join(", ")) : name, keywords.length > 3 ? capital(keywords.slice(3, 6).join(", ")) : name, name];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ titles: string[]; text: string }>({ titles: [], text: "" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const steps: { tag: string; px: number; exact: boolean }[] = sizes.length
    ? sizes.map((x) => ({ tag: x.split(" ")[0], px: Number(x.split(" ")[1]), exact: true }))
    : [
        { tag: "Título", px: 40, exact: false },
        { tag: "Subtítulo", px: 26, exact: false },
        { tag: "Destacado", px: 19, exact: false },
      ];
  const titleAt = (i: number) => saved?.titles[i] || auto[Math.min(i, auto.length - 1)];
  const bodyText = saved?.text || lead;

  function startEditing() {
    setDraft({ titles: steps.map((_, i) => titleAt(i)), text: bodyText });
    setError(null);
    setEditing(true);
  }

  async function save(value: { titles: string[]; text: string | null } | null) {
    setPending(true);
    setError(null);
    // Un texto igual al automático no se guarda: si cambia la marca, sigue al día.
    const payload = value && {
      titles: value.titles.map((t, i) => (t.trim() === auto[Math.min(i, auto.length - 1)] ? "" : t.trim())),
      text: value.text?.trim() && value.text.trim() !== lead ? value.text.trim() : null,
    };
    const result = await saveHierarchyTexts(clientId, payload);
    setPending(false);
    if (!result.ok) return setError(result.error);
    setEditing(false);
    router.refresh();
  }

  return (
    <>
      {internal && (
        <div className="bb-scale-tools">
          {editing ? (
            <>
              <ActionButton icon="check" disabled={pending} onClick={() => save(draft)}>
                {pending ? "Guardando…" : "Guardar textos"}
              </ActionButton>
              <ActionButton icon="close" disabled={pending} onClick={() => setEditing(false)}>
                Cancelar
              </ActionButton>
            </>
          ) : (
            <>
              <ActionButton icon="pencil" onClick={startEditing}>
                Editar textos
              </ActionButton>
              {saved && (
                <ActionButton icon="refresh" disabled={pending} onClick={() => save(null)}>
                  Volver a los automáticos
                </ActionButton>
              )}
            </>
          )}
          {error && <p className="form-error">{error}</p>}
        </div>
      )}
      {/* Se muestra solo la composición con todos los niveles juntos (pedido); la
          escala nivel por nivel aparece solo para editar los textos. */}
      {!editing && (
        <HierarchyTogether levels={steps.map((x, i) => ({ ...x, text: titleAt(i) }))} bodyText={bodyText} display={display} body={body} primary={primary} />
      )}
      {editing && (
        <div className="bb-scale">
          {steps.map((x, i) => (
            <div key={x.tag} className="bb-scale-row">
              <span className="bb-scale-meta">
                <b>{x.tag}</b>
                {x.exact && <span>{x.px} px</span>}
                <span>{display.family}</span>
              </span>
              <textarea
                className="bb-scale-sample bb-scale-input"
                style={{ fontFamily: display.css, fontSize: x.px, fontWeight: 700 }}
                value={draft.titles[i] ?? ""}
                rows={1}
                maxLength={160}
                aria-label={`Texto de ${x.tag}`}
                disabled={pending}
                onChange={(e) => setDraft((d) => ({ ...d, titles: d.titles.map((t, j) => (j === i ? e.target.value : t)) }))}
              />
            </div>
          ))}
          <div className="bb-scale-row">
            <span className="bb-scale-meta">
              <b>Texto</b>
              <span>{body.family}</span>
            </span>
            <textarea
              className="bb-scale-sample text bb-scale-input"
              style={{ fontFamily: body.css }}
              value={draft.text}
              rows={3}
              maxLength={1200}
              aria-label="Texto corrido"
              disabled={pending}
              onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
            />
          </div>
        </div>
      )}
      {(display.usage || body.usage) && (
        <div className="bb-style-grid">
          {[display, ...(body !== display ? [body] : [])].map(
            (f) =>
              f.usage && (
                <div key={f.family} className="bb-style-card">
                  <b style={{ fontFamily: f.css }}>{f.family}</b>
                  <p>{f.usage}</p>
                </div>
              ),
          )}
        </div>
      )}
    </>
  );
}

// Los niveles de la jerarquía juntos en una composición (pedido del usuario: ver
// cómo conviven los tamaños). "Página" usa los tamaños reales; "Pieza" es la misma
// composición sobre el color principal, achicada como en un posteo. Cada
// elemento lleva su nivel al costado ("Marcar niveles").
type Level = { tag: string; px: number; exact: boolean; text: string };

function HierarchyTogether({
  levels,
  bodyText,
  display,
  body,
  primary,
}: {
  levels: Level[];
  bodyText: string;
  display: BoardFont;
  body: BoardFont;
  primary: string | null;
}) {
  const [format, setFormat] = useState<"pagina" | "pieza">("pagina");
  const [marks, setMarks] = useState(true);
  const piece = format === "pieza" && !!primary;
  const scale = piece ? 0.62 : 1;
  const first = bodyText.split(/(?<=\.)\s/)[0] ?? bodyText;
  // Con 4 niveles el más chico va arriba como volanta; el resto, en orden:
  // título, bajada, texto, subtítulo de sección y texto.
  const eyebrow = levels.length >= 4 ? levels[levels.length - 1] : null;
  const main = eyebrow ? levels.slice(0, -1) : levels;
  const blocks: ({ kind: "h"; level: Level } | { kind: "p"; text: string })[] = [
    ...(eyebrow ? [{ kind: "h" as const, level: eyebrow }] : []),
    ...(main[0] ? [{ kind: "h" as const, level: main[0] }] : []),
    ...(main[1] ? [{ kind: "h" as const, level: main[1] }] : []),
    { kind: "p", text: bodyText },
    ...main.slice(2).flatMap((l) => [{ kind: "h" as const, level: l }, { kind: "p" as const, text: first }]),
  ];
  const fg = piece && primary ? (isDark(primary) ? WHITE : INK) : undefined;

  return (
    <section className="bb-together">
      <div className="bb-together-head">
        <div className="bb-voice-tabs" role="tablist" aria-label="Formato">
          <button type="button" role="tab" aria-selected={format === "pagina"} className={format === "pagina" ? "on" : ""} onClick={() => setFormat("pagina")}>
            Página
          </button>
          {primary && (
            <button type="button" role="tab" aria-selected={format === "pieza"} className={format === "pieza" ? "on" : ""} onClick={() => setFormat("pieza")}>
              Pieza
            </button>
          )}
        </div>
        <label className="bb-together-marks">
          <input type="checkbox" checked={marks} onChange={(e) => setMarks(e.target.checked)} />
          Marcar niveles
        </label>
      </div>
      <div
        key={format}
        className={`bb-together-stage${piece ? " piece" : ""}${marks ? " marks" : ""}`}
        style={piece && primary ? { background: primary, color: fg } : undefined}
      >
        {blocks.map((b, i) =>
          b.kind === "h" ? (
            <div key={i} className="bb-together-el" data-level={`${b.level.tag}${b.level.exact ? ` · ${b.level.px} px` : ""}`}>
              <span style={{ fontFamily: display.css, fontSize: Math.round(b.level.px * scale), fontWeight: 700, lineHeight: 1.12 }}>{b.level.text}</span>
            </div>
          ) : (
            <div key={i} className="bb-together-el" data-level="Texto">
              <p style={{ fontFamily: body.css, fontSize: Math.round(15 * (piece ? 0.85 : 1)) }}>{b.text}</p>
            </div>
          ),
        )}
      </div>
    </section>
  );
}

// ---------- Estilo visual ----------

// Las pautas de imagen y gráficos del manual, una tarjeta por tema.
// Explorador por tema (pedido: "son todas cards, algo más visual e interactivo").
// Cada tema junta su pauta con título ("Fotografía: …"), las que le siguen sin
// título y las muestras reales del manual que le corresponden (recortes del PDF
// con kind "estilo", emparejados por nombre). Una muestra sin tema arma el suyo.
type StyleTopic = { title: string; notes: string[]; shots: BoardApp[] };
// La pauta de un tema que se fue a Recursos, para mostrarla al filtrar su categoría.
type ResourceGuide = { category: ResourceCategory; title: string; text: string };
const STOP = new Set(["para", "como", "sobr", "entr", "desd", "esta", "este", "todo", "cada"]);
const stems = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4)
    .map((w) => w.slice(0, 4))
    .filter((w) => !STOP.has(w));

const plain = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function styleTopics(notes: StyleNote[], shots: BoardApp[]): StyleTopic[] {
  const topics: StyleTopic[] = [];
  for (const n of notes) {
    if (n.titled || !topics.length) topics.push({ title: n.titled ? n.head : "General", notes: [n.text], shots: [] });
    else topics[topics.length - 1].notes.push(n.text);
  }
  for (const shot of shots) {
    // Mismo nombre que un tema (sin mayúsculas ni tildes): va ahí. Hace falta
    // porque los nombres cortos ("Kit UI") no dejan raíces de 4 letras y el tema
    // salía repetido.
    const same = topics.find((t) => plain(t.title) === plain(shot.name));
    if (same) {
      same.shots.push(shot);
      continue;
    }
    const name = stems(shot.name);
    let best: StyleTopic | null = null;
    let top = 0;
    for (const t of topics) {
      const title = stems(t.title);
      const body = stems(t.notes.join(" "));
      const score = name.reduce((sum, w) => sum + (title.includes(w) ? 3 : body.includes(w) ? 1 : 0), 0);
      if (score > top) {
        top = score;
        best = t;
      }
    }
    if (best) best.shots.push(shot);
    else topics.push({ title: shot.name, notes: [], shots: [shot] });
  }
  return topics;
}

// A la izquierda los temas; a la derecha el tema elegido: su muestra del manual
// (clic para ampliar, miniaturas si hay varias) o, si no tiene, la pauta en grande
// sobre el color de acento con la tipografía de títulos; abajo, el resto de las pautas.
// Sin muestra propia pero con piezas del manual (posteos, papelería), van tres de
// esas como ejemplo (pedido: "mostrar ejemplos en vez de la card naranja"),
// distintas en cada tema y rotuladas como piezas, no como muestra del tema.
function StylePanel({
  topics,
  pieces,
  accent,
  tint,
  displayCss,
  pending,
  clientId,
  internal,
}: {
  topics: StyleTopic[];
  pieces: BoardApp[];
  accent: string | undefined;
  tint: string | undefined;
  displayCss: string | undefined;
  pending: boolean;
  clientId: string;
  internal: boolean;
}) {
  const [at, setAt] = useState(0);
  const [pick, setPick] = useState(0);
  const [zoom, setZoom] = useState<{ list: BoardApp[]; index: number } | null>(null);
  const shots = topics.flatMap((t) => t.shots);
  const index = Math.min(at, topics.length - 1);
  const topic = topics[index];
  if (!topic) return null;
  const shot = topic.shots[Math.min(pick, topic.shots.length - 1)];
  // Ejemplos de respaldo: primero las de redes (son las que muestran foto y
  // gráfica), tres por tema sin repetir hasta dar la vuelta.
  const pool = [...pieces.filter((a) => a.kind === "redes"), ...pieces.filter((a) => a.kind !== "redes")];
  const samples = shot ? [] : pool.length <= 3 ? pool : [0, 1, 2].map((i) => pool[(index * 3 + i) % pool.length]);
  const visual = !!shot || samples.length > 0;
  const lines = visual ? topic.notes : topic.notes.slice(1);
  const lead = visual ? null : topic.notes[0];
  return (
    <>
      <div className="bb-sx" style={{ "--sx": accent, "--tint": tint } as CSSProperties}>
        <div className="bb-sx-nav" role="tablist" aria-label="Temas del estilo visual">
          {topics.map((t, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === index}
              className={i === index ? "on" : undefined}
              onClick={() => {
                setAt(i);
                setPick(0);
              }}
            >
              <small>{String(i + 1).padStart(2, "0")}</small>
              <b>{t.title}</b>
              {t.shots.length > 0 && <Icon name="image" size={14} strokeWidth={2} />}
            </button>
          ))}
        </div>
        <div key={index} className="bb-sx-main" role="tabpanel">
          {shot ? (
            <div className="bb-sx-stage">
              <button type="button" className="bb-sx-shot" aria-label={`Ampliar ${shot.name}`} onClick={() => setZoom({ list: shots, index: shots.indexOf(shot) })}>
                {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage. */}
                <img src={shot.url} alt={shot.name} />
              </button>
              {topic.shots.length > 1 && (
                <div className="bb-sx-thumbs">
                  {topic.shots.map((x, i) => (
                    <button key={x.index} type="button" className={x === shot ? "on" : undefined} aria-label={`Muestra ${i + 1}`} aria-pressed={x === shot} onClick={() => setPick(i)}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage. */}
                      <img src={x.url} alt="" loading="lazy" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : samples.length ? (
            <div className="bb-sx-stage bb-sx-samples">
              <span className="bb-sx-tag">Piezas del manual</span>
              <div>
                {samples.map((x, i) => (
                  <button key={x.index} type="button" className="bb-sx-shot" aria-label={`Ampliar ${x.name}`} title={x.name} onClick={() => setZoom({ list: samples, index: i })}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage. */}
                    <img src={x.url} alt={x.name} />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            lead && (
              <div className="bb-sx-stage bb-sx-poster" style={accent ? { background: accent, color: isDark(accent) ? WHITE : INK } : undefined}>
                <p className={lead.length > 120 ? "long" : undefined} style={{ fontFamily: displayCss }}>
                  {lead}
                </p>
              </div>
            )
          )}
          {lines.length > 0 && (
            <div className="bb-sx-notes">
              {lines.map((t, i) => (
                <p key={i}>{t}</p>
              ))}
            </div>
          )}
          {internal && shot && (
            <div className="bb-sx-admin">
              <DeleteApplicationButton clientId={clientId} index={shot.index} name={shot.name} />
            </div>
          )}
        </div>
      </div>
      {pending && !shots.length && <p className="bb-hint bb-sx-pending">Buscando las muestras de estilo en el PDF…</p>}
      {zoom && zoom.list[zoom.index] && (
        <Lightbox
          items={zoom.list.map((x) => ({ ...x, group: x.kind === "estilo" ? "Estilo visual" : groupOf(x) }))}
          index={zoom.index}
          onIndex={(i) => setZoom({ ...zoom, index: i })}
          onClose={() => setZoom(null)}
        />
      )}
    </>
  );
}

// ---------- La marca aplicada ----------

// Las piezas reales del manual (recortadas del PDF), todas sobre una mesa de
// trabajo (elegido por el usuario; antes las de redes iban en un Instagram dentro
// de un monitor, que se sacó). Cualquiera se abre grande con Lightbox.
type ViewItem = BoardApp & { group: string };
const groupOf = (a: BoardApp) => (a.kind === "redes" ? "Redes sociales" : "Otras aplicaciones");

// Ancho / alto de cada imagen (se lee al cargarla); undefined mientras tanto.
function useImageRatios(urls: string[]) {
  const [ratios, setRatios] = useState<Record<string, number>>({});
  const key = urls.join("|");
  useEffect(() => {
    let alive = true;
    for (const url of key ? key.split("|") : []) {
      const img = new Image();
      img.onload = () => {
        if (alive && img.naturalWidth && img.naturalHeight) setRatios((m) => (m[url] ? m : { ...m, [url]: img.naturalWidth / img.naturalHeight }));
      };
      img.src = url;
    }
    return () => {
      alive = false;
    };
  }, [key]);
  return ratios;
}

function RealAppsPanel({
  apps,
  tint,
  clientId,
  clientSlug,
  internal,
  pdf,
}: {
  apps: BoardApp[];
  tint: string | undefined;
  clientId: string;
  clientSlug: string;
  internal: boolean;
  pdf: boolean;
}) {
  const [view, setView] = useState<{ list: ViewItem[]; index: number } | null>(null);
  const ratios = useImageRatios(apps.map((a) => a.url));

  if (!apps.length) return null;
  return (
    <>
      <WorkTable items={apps} ratios={ratios} tint={tint} onZoom={(a, list) => setView({ list: list.map((x) => ({ ...x, group: groupOf(x) })), index: list.indexOf(a) })} />

      {internal && (
        <div className="bb-real-admin">
          {apps.map((a) => (
            <span key={a.index} className="bb-deck-chip">
              <span>{a.name}</span>
              <DeleteApplicationButton clientId={clientId} index={a.index} name={a.name} />
            </span>
          ))}
          {pdf && <ApplicationsFromPdf clientSlug={clientSlug} label="Volver a sacar del PDF" />}
        </div>
      )}

      {view && <Lightbox items={view.list} index={view.index} onIndex={(i) => setView({ ...view, index: i })} onClose={() => setView(null)} />}
    </>
  );
}

// ---------- Mesa de trabajo ----------

type Placed = { x: number; y: number; w: number; h: number; r: number };
type TableFilter = "todas" | "redes" | "aplicacion";
const FILTERS: [TableFilter, string][] = [
  ["todas", "Todas"],
  ["redes", "Redes"],
  ["aplicacion", "Otras"],
];

// Dónde va cada pieza (centro y tamaño en px de la mesa): filas del mismo alto,
// centradas, con la cantidad de filas que deja las piezas más grandes sin que
// ninguna se salga. "Suelta" = un poco más chicas, corridas y giradas (fijo para
// cada semilla); si no, alineadas.
function arrange(ratios: number[], W: number, H: number, loose: boolean, seed: number): Placed[] {
  const n = ratios.length;
  if (!n || W < 80 || H < 80) return [];
  const pad = W < 520 ? 14 : 28;
  const gap = W < 520 ? 10 : 18;
  const total = ratios.reduce((s, r) => s + r, 0);
  let best: { h: number; rows: number[][] } | null = null;
  for (let R = 1; R <= Math.min(n, 6); R++) {
    const rows: number[][] = Array.from({ length: R }, () => []);
    let cum = 0;
    ratios.forEach((r, i) => {
      rows[Math.min(R - 1, Math.floor(((cum + r / 2) / total) * R))].push(i);
      cum += r;
    });
    if (rows.some((row) => !row.length)) continue;
    const byWidth = Math.min(...rows.map((row) => (W - 2 * pad - gap * (row.length - 1)) / row.reduce((s, i) => s + ratios[i], 0)));
    const h = Math.min(byWidth, (H - 2 * pad - gap * (R - 1)) / R);
    if (!best || h > best.h) best = { h, rows };
  }
  if (!best) return [];
  const rand = (k: number) => {
    const v = Math.sin((k + 1) * 12.9898 + seed * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };
  const cell = Math.max(40, Math.min(best.h, H * 0.64));
  const h = cell * (loose ? 0.92 : 1);
  const y0 = (H - (best.rows.length * cell + gap * (best.rows.length - 1))) / 2;
  const out: Placed[] = [];
  best.rows.forEach((row, r) => {
    let x = (W - (row.reduce((s, i) => s + ratios[i] * cell, 0) + gap * (row.length - 1))) / 2;
    for (const i of row) {
      const cw = ratios[i] * cell;
      out[i] = {
        x: x + cw / 2 + (loose ? (rand(i) - 0.5) * gap * 1.2 : 0),
        y: y0 + r * (cell + gap) + cell / 2 + (loose ? (rand(i + 50) - 0.5) * gap * 1.4 : 0),
        w: ratios[i] * h,
        h,
        r: loose ? (rand(i + 100) - 0.5) * 9 : 0,
      };
      x += cw + gap;
    }
  });
  return out;
}

// Todas las piezas sobre la mesa, cada una entera y sin marco: clic la abre
// grande, se arrastran (se inclinan según para dónde van) y se filtran por tipo
// si el manual trae de los dos (redes y otras aplicaciones). El fondo toma un
// tinte del color principal de la marca.
function WorkTable({
  items,
  ratios,
  tint,
  onZoom,
}: {
  items: BoardApp[];
  ratios: Record<string, number>;
  tint: string | undefined;
  onZoom: (a: BoardApp, list: BoardApp[]) => void;
}) {
  const [filter, setFilter] = useState<TableFilter>("todas");
  const counts = { todas: items.length, redes: items.filter((a) => a.kind === "redes").length, aplicacion: items.filter((a) => a.kind === "aplicacion").length };
  const mixed = counts.redes > 0 && counts.aplicacion > 0;
  const shown = mixed && filter !== "todas" ? items.filter((a) => a.kind === filter) : items;
  const [loose, setLoose] = useState(true);
  const [seed, setSeed] = useState(1);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  // Lo que se movió a mano (por índice de la pieza) y cuál quedó arriba.
  const [moved, setMoved] = useState<Record<number, { x: number; y: number }>>({});
  const [order, setOrder] = useState<Record<number, number>>({});
  const [lifted, setLifted] = useState<number | null>(null);
  const [tilt, setTilt] = useState(0);
  const table = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; dx: number; dy: number; x0: number; y0: number; lastX: number; dragged: boolean } | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const top = useRef(items.length + 1);

  useEffect(() => {
    const el = table.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: Math.round(el.clientWidth), h: Math.round(el.clientHeight) }));
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (settle.current) clearTimeout(settle.current);
    };
  }, []);

  const ratioKey = shown.map((a) => (ratios[a.url] ?? 1).toFixed(3)).join(",");
  const placed = useMemo(
    () => (box && ratioKey ? arrange(ratioKey.split(",").map(Number), box.w, box.h, loose, seed) : []),
    [ratioKey, box, loose, seed],
  );
  // Al cambiar el armado (filtro, tamaño, orden) lo movido a mano se descarta.
  const layoutKey = `${filter}|${ratioKey}|${box?.w}x${box?.h}|${loose}|${seed}`;
  const [lastKey, setLastKey] = useState(layoutKey);
  if (lastKey !== layoutKey) {
    setLastKey(layoutKey);
    setMoved({});
    setLifted(null);
  }

  const drop = () => {
    drag.current = null;
    if (settle.current) clearTimeout(settle.current);
    setTilt(0);
    setLifted(null);
  };

  return (
    <div className="wt">
      <div className="wt-bar">
        {mixed && (
          <div className="bb-seg" role="group" aria-label="Qué piezas mostrar">
            {FILTERS.map(([id, label]) => (
              <button key={id} type="button" className={filter === id ? "on" : undefined} aria-pressed={filter === id} onClick={() => setFilter(id)}>
                {label} <small>{counts[id]}</small>
              </button>
            ))}
          </div>
        )}
        <span className="bb-hint wt-hint">Clic para ampliar · arrastrá para mover</span>
        <div className="wt-tools">
          <button
            type="button"
            className="act-btn"
            onClick={() => {
              setLoose(false);
              setMoved({});
            }}
          >
            <Icon name="grid" size={14} strokeWidth={2} />
            <span>Ordenar</span>
          </button>
          <button
            type="button"
            className="act-btn"
            onClick={() => {
              setLoose(true);
              setSeed(seed + 1);
              setMoved({});
            }}
          >
            <Icon name="refresh" size={14} strokeWidth={2} />
            <span>Desparramar</span>
          </button>
        </div>
      </div>
      <div ref={table} className="wt-table" style={tint ? ({ "--tint": tint } as CSSProperties) : undefined}>
        {shown.map((a, i) => {
          const p = placed[i];
          if (!p || !box) return null;
          const at = moved[a.index] ?? p;
          const up = lifted === a.index;
          return (
            <div
              key={a.index}
              className={`wt-piece${up ? " lifted" : ""}`}
              style={
                {
                  left: at.x,
                  top: at.y,
                  width: p.w,
                  height: p.h,
                  zIndex: up ? 9999 : (order[a.index] ?? i + 1),
                  "--r": `${up ? tilt : p.r}deg`,
                } as CSSProperties
              }
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                const rect = table.current!.getBoundingClientRect();
                drag.current = { id: a.index, dx: e.clientX - rect.left - at.x, dy: e.clientY - rect.top - at.y, x0: e.clientX, y0: e.clientY, lastX: e.clientX, dragged: false };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                const d = drag.current;
                if (!d || d.id !== a.index) return;
                if (!d.dragged) {
                  if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 5) return;
                  d.dragged = true;
                  top.current += 1;
                  const z = top.current;
                  setOrder((o) => ({ ...o, [a.index]: z }));
                  setLifted(a.index);
                }
                const rect = table.current!.getBoundingClientRect();
                const x = Math.min(box.w - 24, Math.max(24, e.clientX - rect.left - d.dx));
                const y = Math.min(box.h - 24, Math.max(24, e.clientY - rect.top - d.dy));
                setMoved((m) => ({ ...m, [a.index]: { x, y } }));
                // Se inclina hacia donde va y se endereza al frenar.
                setTilt(Math.max(-8, Math.min(8, (e.clientX - d.lastX) * 0.8)));
                d.lastX = e.clientX;
                if (settle.current) clearTimeout(settle.current);
                settle.current = setTimeout(() => setTilt(0), 110);
              }}
              onPointerUp={() => {
                const d = drag.current;
                drop();
                if (d && d.id === a.index && !d.dragged) onZoom(a, shown);
              }}
              onPointerCancel={drop}
              onKeyDown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                e.preventDefault();
                onZoom(a, shown);
              }}
              tabIndex={0}
              role="button"
              aria-label={`${a.name}: Enter para verla grande`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage. */}
              <img src={a.url} alt={a.name} draggable={false} />
              <span className="wt-name">{a.name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Vista grande en su propio <dialog> modal (queda arriba del panel, en el top
// layer): la pieza entera sobre fondo oscuro difuminado, con su rama y nombre,
// contador, descarga, flechas (← → o deslizando en el celular) y miniaturas abajo.
function Lightbox({
  items,
  index,
  onIndex,
  onClose,
}: {
  items: (BoardApp & { group: string })[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const thumbs = useRef<HTMLDivElement>(null);
  const swipe = useRef<number | null>(null);
  // Tamaño real de la imagen abierta: las piezas del PDF suelen ser chicas y se
  // agrandan hasta un tope (suavizadas), no hasta llenar la pantalla.
  const [nat, setNat] = useState<{ id: number; w: number; h: number } | null>(null);
  const item = items[index];
  const many = items.length > 1;
  const go = (step: number) => onIndex((index + step + items.length) % items.length);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  useEffect(() => {
    thumbs.current?.querySelector<HTMLElement>(".on")?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [index]);

  const download = `${item.url}${item.url.includes("?") ? "&" : "?"}download=${encodeURIComponent(`${item.name}.jpg`)}`;
  return (
    <dialog
      ref={ref}
      className="bb-lightbox"
      aria-label={`${item.group}: ${item.name}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => {
        if (!many || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
        e.preventDefault();
        e.stopPropagation();
        go(e.key === "ArrowRight" ? 1 : -1);
      }}
    >
      <div className="bb-lb-top">
        <span className="bb-lb-title">
          <small>{item.group}</small>
          <b>{item.name}</b>
        </span>
        <span className="bb-lb-tools">
          {many && (
            <span className="bb-lb-count">
              {index + 1} / {items.length}
            </span>
          )}
          <a className="bb-lb-btn" href={download} aria-label={`Descargar ${item.name}`} title="Descargar">
            <Icon name="download" size={17} strokeWidth={2} />
          </a>
          <button type="button" className="bb-lb-btn" aria-label="Cerrar" title="Cerrar (Esc)" onClick={onClose}>
            <span aria-hidden>×</span>
          </button>
        </span>
      </div>

      <div
        className="bb-lb-stage"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
        onPointerDown={(e) => {
          swipe.current = e.clientX;
        }}
        onPointerUp={(e) => {
          if (swipe.current === null) return;
          const dx = e.clientX - swipe.current;
          swipe.current = null;
          if (many && Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage. */}
        <img
          key={item.index}
          src={item.url}
          alt={item.name}
          draggable={false}
          className={nat?.id === item.index ? "sized" : undefined}
          style={nat?.id === item.index ? ({ "--nw": `${nat.w}px`, "--ar": nat.w / nat.h } as CSSProperties) : undefined}
          onLoad={(e) => {
            const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
            if (w && h) setNat({ id: item.index, w, h });
          }}
        />
        {many && (
          <>
            <button type="button" className="bb-lb-arrow prev" aria-label="Anterior" onClick={() => go(-1)}>
              ‹
            </button>
            <button type="button" className="bb-lb-arrow next" aria-label="Siguiente" onClick={() => go(1)}>
              ›
            </button>
          </>
        )}
      </div>

      {many && (
        <div className="bb-lb-thumbs" ref={thumbs}>
          {items.map((a, i) => (
            <button
              key={a.index}
              type="button"
              className={i === index ? "on" : undefined}
              aria-label={`Ver ${a.name}`}
              aria-current={i === index ? "true" : undefined}
              onClick={() => onIndex(i)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage. */}
              <img src={a.url} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </dialog>
  );
}

function ExamplesPanel({
  name,
  colors,
  primary,
  display,
  body,
  logo,
  voice,
}: BoardProps & { primary: BrandColor; display: BoardFont | undefined; body: BoardFont | undefined; logo: BoardFile | undefined }) {
  // Combinaciones legibles para los fondos de las piezas: arranca con el color principal.
  const combos = useMemo(() => {
    const list = [...colors.map((c) => c.hex), WHITE];
    const out: { bg: string; fg: string; accent: string }[] = [];
    for (const bg of list) {
      const fg = [WHITE, INK, ...list].filter((x) => x !== bg).sort((a, b) => contrast(bg, b) - contrast(bg, a))[0];
      const accent = list.filter((x) => x !== bg && x !== fg).sort((a, b) => contrast(bg, b) - contrast(bg, a))[0] ?? fg;
      if (contrast(bg, fg) >= 4.5) out.push({ bg, fg, accent });
    }
    const first = out.findIndex((x) => x.bg === primary.hex);
    return first > 0 ? [out[first], ...out.filter((_, i) => i !== first)] : out;
  }, [colors, primary.hex]);
  const [i, setI] = useState(0);
  const combo = combos[i % Math.max(combos.length, 1)] ?? { bg: primary.hex, fg: isDark(primary.hex) ? WHITE : INK, accent: colors[1]?.hex ?? INK };
  const headFont = display?.css;
  const bodyFont = body?.css ?? headFont;
  const headline = voice.keywords.slice(0, 2).join(" y ") || name;
  const btnFg = isDark(combo.accent) ? WHITE : INK;
  // La historia usa la combinación siguiente, para que no repita los colores del posteo.
  const story = combos.length > 1 ? combos[(i + 1) % combos.length] : combo;

  return (
    <>
      <div className="bb-block-head">
        <span className="bb-hint">Piezas de muestra con los colores y tipografías de la marca.</span>
        {combos.length > 1 && (
          <button type="button" className="act-btn" onClick={() => setI((x) => x + 1)}>
            <Icon name="refresh" size={14} strokeWidth={2} />
            <span>Otra combinación</span>
          </button>
        )}
      </div>
      <div className="bb-mockups">
        <figure>
          <div className="bb-mock-post" style={{ background: combo.bg, color: combo.fg }}>
            {logo?.image && logo.url ? (
              // eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage.
              <img src={logo.url} alt="" className="bb-mock-logo" />
            ) : (
              <span className="bb-mock-brand" style={{ fontFamily: headFont }}>
                {name}
              </span>
            )}
            <span className="bb-mock-head" style={{ fontFamily: headFont }}>
              {headline}
            </span>
            <span className="bb-mock-cta" style={{ background: combo.accent, color: btnFg, fontFamily: bodyFont }}>
              Conocé más
            </span>
          </div>
          <figcaption>Posteo</figcaption>
        </figure>

        <figure className="bb-mock-story-fig">
          <div className="bb-mock-story" style={{ background: story.bg, color: story.fg }}>
            <span className="bb-mock-story-bar" />
            {logo?.image && logo.url ? (
              // eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage.
              <img src={logo.url} alt="" className="bb-mock-logo" />
            ) : (
              <span className="bb-mock-brand" style={{ fontFamily: headFont }}>
                {name}
              </span>
            )}
            <span className="bb-mock-head" style={{ fontFamily: headFont }}>
              {voice.keywords[2] ?? headline}
            </span>
            <span className="bb-mock-cta" style={{ background: story.accent, color: isDark(story.accent) ? WHITE : INK, fontFamily: bodyFont }}>
              Deslizá
            </span>
          </div>
          <figcaption>Historia</figcaption>
        </figure>

        <figure className="bb-mock-card">
          <div className="bb-mock-card-front" style={{ background: combo.bg, color: combo.fg }}>
            <span style={{ fontFamily: headFont }}>{name}</span>
          </div>
          <div className="bb-mock-card-back" style={{ fontFamily: bodyFont }}>
            <b style={{ fontFamily: headFont, color: combo.bg === WHITE ? combo.accent : combo.bg }}>Nombre Apellido</b>
            <span>Cargo</span>
            <span>hola@marca.com</span>
          </div>
          <figcaption>Tarjeta</figcaption>
        </figure>

        <figure className="bb-mock-web">
          <div className="bb-mock-web-frame">
            <div className="bb-mock-nav" style={{ fontFamily: bodyFont }}>
              <b style={{ fontFamily: headFont }}>{name}</b>
              <span>Inicio · Proyectos · Contacto</span>
            </div>
            <div className="bb-mock-hero" style={{ background: combo.bg, color: combo.fg }}>
              <span className="bb-mock-head" style={{ fontFamily: headFont }}>
                {headline}
              </span>
              <span className="bb-mock-btns" style={{ fontFamily: bodyFont }}>
                <span style={{ background: combo.accent, color: btnFg }}>Pedí tu presupuesto</span>
                <span style={{ borderColor: combo.fg }}>Ver más</span>
              </span>
            </div>
          </div>
          <figcaption>Web</figcaption>
        </figure>
      </div>
    </>
  );
}

// ---------- Recursos ----------

// Tipo de cada archivo, con el ícono y el color de la solapa Drive (.dv-thumb.<tipo>).
function fileKind(a: BoardFile): { kind: string; icon: IconName; label: string } {
  const ext = a.fileName.split(".").pop()?.toLowerCase() ?? "";
  if (a.image) return { kind: "image", icon: "image", label: "Imagen" };
  if (a.kind === "fuente" || /^(otf|ttf|woff2?)$/.test(ext)) return { kind: "doc", icon: "file-text", label: "Tipografía" };
  if (ext === "pdf") return { kind: "pdf", icon: "file-text", label: "PDF" };
  if (/^(zip|rar|7z)$/.test(ext)) return { kind: "zip", icon: "archive", label: "Comprimido" };
  if (/^(mp4|mov|webm)$/.test(ext)) return { kind: "video", icon: "play", label: "Video" };
  if (/^(ai|eps|psd|indd|fig|sketch)$/.test(ext)) return { kind: "slide", icon: "image", label: ext.toUpperCase() };
  return { kind: "file", icon: "file", label: "Archivo" };
}

// Como la cuadrícula de Drive: las imágenes con su vista previa, el resto con el
// ícono del tipo; tocar la tarjeta abre el archivo. Arriba, chips para filtrar
// por categoría (iconografía, tramas…: pedido del usuario), solo las que tienen
// algo; el equipo cambia la categoría de cada recurso desde su tarjeta.
function FilesPanel({
  clientId,
  files,
  extracted,
  guides,
  internal,
}: {
  clientId: string;
  files: BoardFile[];
  extracted: BoardApp[];
  guides: ResourceGuide[];
  internal: boolean;
}) {
  const [filter, setFilter] = useState<ResourceCategory | "todos">("todos");
  const [zoom, setZoom] = useState<number | null>(null);
  const catOf = (a: BoardApp) => a.category ?? "graficos";
  const count = (id: ResourceCategory) => files.filter((f) => f.category === id).length + extracted.filter((a) => catOf(a) === id).length;
  const cats = RESOURCE_CATEGORIES.map((c) => ({ ...c, n: count(c.id) })).filter((c) => c.n);
  const active = filter !== "todos" && cats.some((c) => c.id === filter) ? filter : "todos";
  const shown = active === "todos" ? files : files.filter((f) => f.category === active);
  const fromPdf = active === "todos" ? extracted : extracted.filter((a) => catOf(a) === active);
  const guide = active === "todos" ? [] : guides.filter((g) => g.category === active);

  return (
    <>
      {cats.length > 1 && (
        <div className="bb-voice-tabs bb-res-filter" role="tablist" aria-label="Filtrar recursos">
          <button type="button" role="tab" aria-selected={active === "todos"} className={active === "todos" ? "on" : ""} onClick={() => setFilter("todos")}>
            Todos <span>{files.length + extracted.length}</span>
          </button>
          {cats.map((c) => (
            <button key={c.id} type="button" role="tab" aria-selected={active === c.id} className={active === c.id ? "on" : ""} onClick={() => setFilter(c.id)}>
              {c.label} <span>{c.n}</span>
            </button>
          ))}
        </div>
      )}
      {guide.length > 0 && (
        <div className="bb-res-guide">
          {guide.map((g) => (
            <p key={g.title}>
              <b>{g.title}</b>
              {g.text}
            </p>
          ))}
        </div>
      )}
      {shown.length || fromPdf.length ? (
        <div className="dv-files">
          {fromPdf.map((a) => (
            <div key={`pdf-${a.index}`} className="dv-card">
              <button type="button" className="dv-card-main" onClick={() => setZoom(extracted.indexOf(a))}>
                <span className="dv-thumb image bb-res-thumb">
                  {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage. */}
                  <img src={a.url} alt="" loading="lazy" />
                </span>
                <span className="dv-card-name">
                  <span className="dv-kind image" aria-hidden>
                    <Icon name="image" size={15} strokeWidth={2} />
                  </span>
                  <span>{a.name}</span>
                </span>
              </button>
              <div className="dv-card-foot">
                <span>{RESOURCE_CATEGORIES.find((c) => c.id === catOf(a))?.label} · Del manual</span>
                <span className="dv-card-acts">
                  <a
                    className="act-btn icon-only"
                    href={`${a.url}${a.url.includes("?") ? "&" : "?"}download=${encodeURIComponent(`${a.name}.png`)}`}
                    aria-label={`Descargar ${a.name}`}
                    title="Descargar PNG"
                  >
                    <Icon name="download" size={14} strokeWidth={2} />
                  </a>
                  {internal && <DeleteApplicationButton clientId={clientId} index={a.index} name={a.name} />}
                </span>
              </div>
            </div>
          ))}
          {shown.map((a) => {
            const k = fileKind(a);
            const inner = (
              <>
                <span className={`dv-thumb ${k.kind}`}>
                  {a.image && a.url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage.
                    <img src={a.url} alt="" loading="lazy" />
                  ) : (
                    <span className="dv-thumb-kind" aria-hidden>
                      <Icon name={k.icon} size={40} strokeWidth={1.6} />
                    </span>
                  )}
                </span>
                <span className="dv-card-name">
                  <span className={`dv-kind ${k.kind}`} title={k.label} aria-hidden>
                    <Icon name={k.icon} size={15} strokeWidth={2} />
                  </span>
                  <span title={a.fileName}>{a.name}</span>
                </span>
              </>
            );
            return (
              <div key={a.id} className="dv-card">
                {a.url ? (
                  <a className="dv-card-main" href={a.url} target="_blank" rel="noopener noreferrer">
                    {inner}
                  </a>
                ) : (
                  <span className="dv-card-main">{inner}</span>
                )}
                <div className="dv-card-foot">
                  {internal ? (
                    <CategorySelect clientId={clientId} id={a.id} value={a.category} />
                  ) : (
                    <span>
                      {RESOURCE_CATEGORIES.find((c) => c.id === a.category)?.label ?? k.label} · {a.size}
                    </span>
                  )}
                  <span className="dv-card-acts">
                    {a.download && (
                      <a className="act-btn icon-only" href={a.download} aria-label={`Descargar ${a.name}`} title="Descargar">
                        <Icon name="download" size={14} strokeWidth={2} />
                      </a>
                    )}
                    {internal && <DeleteAssetButton clientId={clientId} id={a.id} name={a.name} />}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="bb-hint">Todavía no hay archivos.</p>
      )}
      {zoom !== null && extracted[zoom] && (
        <Lightbox
          items={extracted.map((x) => ({ ...x, group: "Recursos" }))}
          index={zoom}
          onIndex={setZoom}
          onClose={() => setZoom(null)}
        />
      )}
      {internal && (
        <div className="bb-actions">
          <AssetUploader clientId={clientId} kind="fuente" label="Subir tipografías" />
          <AssetUploader clientId={clientId} kind="otro" label="Subir otros" />
        </div>
      )}
    </>
  );
}

// La categoría de un recurso, para el equipo: cambia al elegir otra.
function CategorySelect({ clientId, id, value }: { clientId: string; id: string; value: ResourceCategory }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <label className="dv-cat" title={error ?? "Categoría"}>
      <select
        value={value}
        disabled={pending}
        aria-label="Categoría"
        onChange={async (e) => {
          setPending(true);
          setError(null);
          const r = await setResourceCategory(clientId, id, e.target.value);
          setPending(false);
          if (!r.ok) setError(r.error);
        }}
      >
        {RESOURCE_CATEGORIES.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <Icon name="chevron" size={11} strokeWidth={2.4} />
    </label>
  );
}
