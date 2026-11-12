"use client";

import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/icons";
import { type BrandColor, type LogoSource, cmykText, contrast, contrastGrade, isDark, rgbText } from "@/lib/brand-shared";
import { AssetUploader, CopyText, DeleteApplicationButton, DeleteAssetButton, MainLogoButton, Swatch } from "./brand-ui";
import { useRouter } from "next/navigation";
import { ApplicationsFromPdf, LogoFromPdf, extractApplications } from "./logo-from-pdf";
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
  size: string;
  kind: "logo" | "fuente" | "otro";
};

// Aplicación real o ejemplo para redes recortado del PDF (index: su lugar en
// data.applications, para quitarla).
export type BoardApp = { index: number; name: string; kind: "redes" | "aplicacion"; url: string; page: number; x: number; y: number; w: number; h: number };

// Perfil de Instagram para el mockup: de Meta si el cliente lo tiene conectado
// (real = true); si no, solo nombre, rubro y web del cliente, sin números.
export type BoardInstagram = {
  username: string;
  name: string | null;
  picture: string | null;
  followers: number | null;
  following: number | null;
  posts: number | null;
  bio: string | null;
  website: string | null;
  category: string | null;
  real: boolean;
};

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
  instagram: BoardInstagram | null;
  summary: string;
  colors: BrandColor[];
  fonts: BoardFont[];
  logos: BoardFile[];
  files: BoardFile[];
  logoNotes: { description: string | null; rules: string[] };
  voice: { description: string | null; keywords: string[]; dos: string[]; donts: string[] };
  imagery: string[];
  pdf: { view: string; download: string | null; size: string } | null;
};

type PanelId = "logo" | "colores" | "tipografia" | "tono" | "ejemplos" | "recursos";

const WHITE = "#FFFFFF";
const INK = "#111111";

const TITLES: Record<PanelId, string> = {
  logo: "Logo",
  colores: "Colores",
  tipografia: "Tipografía",
  tono: "Tono",
  ejemplos: "Aplicaciones",
  recursos: "Recursos",
};

const ICONS: Record<PanelId, IconName> = {
  logo: "image",
  colores: "grid",
  tipografia: "file-text",
  tono: "chat",
  ejemplos: "sparkles",
  recursos: "folder",
};

// Tamaño de un bloque en la grilla de 12 columnas (en el celular, de 2).
type Span = { c: number; r: number; m: number; mr: number };
const spanStyle = (s: Span, i: number) => ({ "--c": s.c, "--r": s.r, "--mc": s.m, "--mr": s.mr, "--i": i }) as CSSProperties;

// El fondo de un logo: el primero donde se lee (blanco, el color principal, los
// otros de la marca, casi negro) según sus colores reales; mientras no se leyeron,
// por el nombre del archivo.
function logoBackground(l: BoardFile | undefined, tones: Record<string, LogoTone | null>, colors: BrandColor[], primary: BrandColor | undefined) {
  const t = l?.url ? tones[l.url] : null;
  if (t) return bestBackground(t, [WHITE, ...(primary ? [primary.hex] : []), ...colors.slice(0, 5).map((c) => c.hex), INK]);
  return l?.negative ? (primary?.hex ?? INK) : WHITE;
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
  const scored = primary ? images.filter((l) => tones[l.url!] && !tones[l.url!]!.ownBackground) : [];
  const examplesLogo = scored.length
    ? scored.reduce((best, l) => (readability(tones[l.url!]!, primary!.hex) > readability(tones[best.url!]!, primary!.hex) ? l : best))
    : (images.find((l) => (primary && isDark(primary.hex) ? l.negative : !l.negative)) ?? images[0]);
  const heroLogo = p.logos[0]?.image && p.logos[0].url ? p.logos[0] : undefined;
  const heroBg = heroLogo ? logoBackground(heroLogo, tones, p.colors, primary) : primary?.hex;
  const displayCss = display?.css;
  const hasTone = p.voice.keywords.length > 0 || !!p.voice.description || p.voice.dos.length > 0;
  const showFiles = p.files.length > 0 || p.internal;
  // Aplicada: las piezas reales del PDF; sin ellas, piezas de muestra (con color principal).
  const realApps = p.applications;
  const hasExamples = realApps.length > 0 || !!primary || (p.internal && !!p.pdf);
  const appsPending = useAutoApplications(p.internal && !!p.pdf && !p.appsSearched, p.clientSlug);

  const sections: PanelId[] = [
    "logo",
    ...(p.colors.length ? (["colores"] as const) : []),
    ...(p.fonts.length ? (["tipografia"] as const) : []),
    ...(hasTone ? (["tono"] as const) : []),
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
          {p.voice.keywords.length > 0 && <span className="bb-logo-words">{p.voice.keywords.slice(0, 3).join(" · ")}</span>}
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

        {realApps.length > 0 ? (
          <button type="button" className="bb-tile bb-examples bb-real" style={spanStyle(S.examples, order++)} onClick={() => open("ejemplos")}>
            <span className="bb-real-strip">
              {realApps.slice(0, 4).map((a) => (
                // eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage.
                <img key={a.index} src={a.url} alt="" loading="lazy" />
              ))}
            </span>
            <TileLabel icon="sparkles" onDark>
              Aplicaciones
            </TileLabel>
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
              <small>{p.files.length ? `${p.files.length} ${p.files.length === 1 ? "archivo" : "archivos"}` : "Sin archivos"}</small>
            </span>
            <Icon name="chevron" size={16} className="bb-small-go" />
          </button>
        )}
      </div>

      {panel && (
        <Sheet sections={sections} current={panel} onPick={setPanel} onClose={() => setPanel(null)}>
          {panel === "colores" && <ColorsPanel colors={p.colors} />}
          {panel === "tipografia" && <TypePanel key={fontIndex} fonts={p.fonts} initial={fontIndex} />}
          {panel === "logo" && <LogoPanel {...p} primary={primary} displayCss={displayCss} tones={tones} />}
          {panel === "tono" && <TonePanel voice={p.voice} imagery={p.imagery} summary={p.summary} displayCss={displayCss} />}
          {panel === "ejemplos" && (
            <>
              <RealAppsPanel apps={realApps} instagram={p.instagram} name={p.name} logo={heroLogo?.url ?? null} logoBg={heroBg} clientId={p.clientId} clientSlug={p.clientSlug} internal={p.internal} pdf={!!p.pdf} />
              {!realApps.length && primary && <ExamplesPanel {...p} primary={primary} display={display} body={body} logo={examplesLogo} />}
            </>
          )}
          {panel === "recursos" && <FilesPanel clientId={p.clientId} files={p.files} internal={p.internal} />}
        </Sheet>
      )}
    </>
  );
}

// Manuales leídos antes de que se sacaran las aplicaciones: el equipo las saca
// solo al abrir el tablero (una vez por carga de página y cliente: `autoApps`
// evita repetirla, también con el doble efecto de desarrollo). Devuelve si está corriendo.
const autoApps = new Map<string, Promise<string | null>>();

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
    .replace(/[̀-ͯ]/g, "")
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
  // alrededor, cada una sobre su fondo automático.
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

      {logoNotes.rules.length > 0 && (
        <details className="bb-details">
          <summary>Reglas de uso · {logoNotes.rules.length}</summary>
          {logoNotes.description && <p>{logoNotes.description}</p>}
          <ol>
            {logoNotes.rules.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ol>
        </details>
      )}
    </>
  );
}

// ---------- Tono ----------

function TonePanel({
  voice,
  imagery,
  summary,
  displayCss,
}: {
  voice: BoardProps["voice"];
  imagery: string[];
  summary: string;
  displayCss: string | undefined;
}) {
  return (
    <>
      {voice.keywords.length > 0 && (
        <div className="bb-keywords" style={{ fontFamily: displayCss }}>
          {voice.keywords.map((k) => (
            <span key={k}>{k}</span>
          ))}
        </div>
      )}
      {(voice.description || summary) && <p className="bb-quote">{voice.description ?? summary}</p>}
      {(voice.dos.length > 0 || voice.donts.length > 0) && (
        <div className="bb-dodont">
          <div>
            <h3 className="ok">
              <Icon name="check" size={15} strokeWidth={2.4} /> Sí
            </h3>
            {voice.dos.map((d, i) => (
              <p key={i}>{d}</p>
            ))}
          </div>
          <div>
            <h3 className="no">
              <Icon name="close" size={15} strokeWidth={2.4} /> No
            </h3>
            {voice.donts.map((d, i) => (
              <p key={i}>{d}</p>
            ))}
          </div>
        </div>
      )}
      {imagery.length > 0 && (
        <details className="bb-details">
          <summary>Imágenes y gráficos · {imagery.length}</summary>
          <ol>
            {imagery.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ol>
        </details>
      )}
    </>
  );
}

// ---------- La marca aplicada ----------

// Las piezas reales del manual (recortadas del PDF), en dos vistas una abajo de
// la otra (elegidas por el usuario):
// - Redes sociales: Instagram en una computadora (perfil con los datos reales
//   de Meta si está conectado, grilla, posteo abierto e historias).
// - Otras aplicaciones: sobre una mesa de trabajo (se arrastran, se levantan y se
//   ordenan).
// Cualquiera se abre grande con Lightbox.
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
  instagram,
  name,
  logo,
  logoBg,
  clientId,
  clientSlug,
  internal,
  pdf,
}: {
  apps: BoardApp[];
  instagram: BoardInstagram | null;
  name: string;
  logo: string | null;
  logoBg: string | undefined;
  clientId: string;
  clientSlug: string;
  internal: boolean;
  pdf: boolean;
}) {
  const [view, setView] = useState<{ list: ViewItem[]; index: number } | null>(null);
  const ratios = useImageRatios(apps.map((a) => a.url));
  const social = apps.filter((a) => a.kind === "redes");
  const others = apps.filter((a) => a.kind === "aplicacion");
  const open = (list: BoardApp[], a: BoardApp) => setView({ list: list.map((x) => ({ ...x, group: groupOf(x) })), index: list.indexOf(a) });

  if (!apps.length) return null;
  return (
    <>
      {social.length > 0 && (
        <section className="bb-real-group">
          <div className="bb-block-head">
            <h3>Redes sociales</h3>
            <span className="bb-hint">Tocá un posteo o una historia</span>
          </div>
          <SocialMockups
            items={social}
            ratios={ratios}
            profile={
              instagram ?? { username: name.toLowerCase().replace(/[^a-z0-9._]+/g, ""), name, picture: null, followers: null, following: null, posts: null, bio: null, website: null, category: null, real: false }
            }
            logo={logo}
            logoBg={logoBg}
            onZoom={(a) => open(social, a)}
          />
          {internal && instagram && !instagram.real && (
            <p className="bb-hint igd-note">Conectando Meta en el cliente se ven sus seguidores y su bio reales.</p>
          )}
        </section>
      )}

      {others.length > 0 && (
        <section className="bb-real-group">
          <div className="bb-block-head">
            <h3>Otras aplicaciones</h3>
            <span className="bb-hint">Arrastrá las piezas; doble clic para verlas grandes</span>
          </div>
          <WorkTable items={others} ratios={ratios} onZoom={(a) => open(others, a)} />
        </section>
      )}

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

// ---------- Redes: Instagram en una computadora ----------

type IgScreen = { at: "perfil" } | { at: "post"; i: number } | { at: "historia"; i: number };
const STORY_MS = 5000;

// Números como los muestra Instagram: 1.234, 12,3 mil, 1,2 M.
const igCount = (n: number) =>
  n < 10000 ? n.toLocaleString("es-AR") : new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 1 }).format(n);

function SocialMockups({
  items,
  ratios,
  profile,
  logo,
  logoBg,
  onZoom,
}: {
  items: BoardApp[];
  ratios: Record<string, number>;
  profile: BoardInstagram;
  logo: string | null;
  logoBg: string | undefined;
  onZoom: (a: BoardApp) => void;
}) {
  const [screen, setScreen] = useState<IgScreen>({ at: "perfil" });
  const [liked, setLiked] = useState<Record<number, boolean>>({});
  // Historias: las verticales (9:16); el resto son posteos. Sin posteos, todas van a la grilla.
  const vertical = items.filter((a) => (ratios[a.url] ?? 1) < 0.7);
  const posts = items.filter((a) => !vertical.includes(a));
  const stories = posts.length ? vertical : [];
  const grid = posts.length ? posts : vertical;
  const post = screen.at === "post" ? grid[screen.i] : undefined;
  const user = profile.username;
  const like = (a: BoardApp) => setLiked((m) => ({ ...m, [a.index]: !m[a.index] }));
  const host = profile.website?.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

  const avatar = (size: number) => (
    <span className="ig-avatar" style={{ width: size, height: size, background: profile.picture ? "#fff" : (logoBg ?? "#fff") }}>
      {profile.picture || logo ? (
        // eslint-disable-next-line @next/next/no-img-element -- foto de Instagram o URL firmada de Storage.
        <img src={(profile.picture ?? logo)!} alt="" className={profile.picture ? "photo" : undefined} />
      ) : (
        <b>{profile.name?.charAt(0)}</b>
      )}
    </span>
  );

  return (
    <div className="igd">
      <div className="igd-monitor">
        <div className="igd-browser">
          <div className="igd-page">
            <div className="igd-profile">
              <div className="igd-head">
                <span className={stories.length ? "ig-ring" : "igd-plain"}>{avatar(118)}</span>
                <div className="igd-info">
                  <div className="igd-row">
                    <b className="igd-user">{user}</b>
                  </div>
                  <div className="igd-row igd-stats">
                    <span>
                      <b>{igCount(profile.posts ?? grid.length)}</b> publicaciones
                    </span>
                    {profile.followers !== null && (
                      <span>
                        <b>{igCount(profile.followers)}</b> seguidores
                      </span>
                    )}
                    {profile.following !== null && (
                      <span>
                        <b>{igCount(profile.following)}</b> seguidos
                      </span>
                    )}
                  </div>
                  <div className="igd-bio">
                    {profile.name && <b>{profile.name}</b>}
                    {profile.category && <span className="igd-cat">{profile.category}</span>}
                    {profile.bio && <span className="igd-text">{profile.bio}</span>}
                    {host && (
                      <a href={profile.website!.startsWith("http") ? profile.website! : `https://${profile.website}`} target="_blank" rel="noopener noreferrer" className="igd-link">
                        <Icon name="globe" size={12} strokeWidth={2.2} />
                        {host}
                      </a>
                    )}
                  </div>
                </div>
              </div>
              <IgHighlights stories={stories} onOpen={(i) => setScreen({ at: "historia", i })} />
              <div className="igd-tabs" aria-hidden>
                <span className="on">
                  <Icon name="grid" size={12} strokeWidth={2.2} />
                  Publicaciones
                </span>
                <span>
                  <Icon name="play" size={12} strokeWidth={2.2} />
                  Reels
                </span>
                <span>
                  <Icon name="users" size={12} strokeWidth={2.2} />
                  Etiquetadas
                </span>
              </div>
              <div className="igd-grid">
                {grid.map((a, i) => (
                  <button key={a.index} type="button" onClick={() => setScreen({ at: "post", i })} aria-label={`Abrir ${a.name}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage. */}
                    <img src={a.url} alt={a.name} loading="lazy" />
                    {liked[a.index] && <span className="igd-liked">♥</span>}
                  </button>
                ))}
              </div>
            </div>

            {post && screen.at === "post" && (
              <div className="igd-modal" onClick={(e) => e.target === e.currentTarget && setScreen({ at: "perfil" })}>
                <button type="button" className="igd-close" onClick={() => setScreen({ at: "perfil" })} aria-label="Cerrar posteo">
                  ×
                </button>
                {screen.i > 0 && (
                  <button type="button" className="ig-nav prev" onClick={() => setScreen({ at: "post", i: screen.i - 1 })} aria-label="Posteo anterior">
                    ‹
                  </button>
                )}
                <div className="igd-card">
                  <button type="button" className="igd-media" onClick={() => onZoom(post)} onDoubleClick={() => like(post)} aria-label={`Ver ${post.name} en grande`}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage. */}
                    <img key={post.index} src={post.url} alt={post.name} />
                  </button>
                  <div className="igd-side">
                    <div className="ig-post-head">
                      {avatar(30)}
                      <b>{user}</b>
                    </div>
                    <p className="ig-caption">
                      <b>{user}</b> {post.name}
                    </p>
                    <div className="ig-actions">
                      <LikeButton liked={!!liked[post.index]} onLike={() => like(post)} />
                    </div>
                  </div>
                </div>
                {screen.i < grid.length - 1 && (
                  <button type="button" className="ig-nav next" onClick={() => setScreen({ at: "post", i: screen.i + 1 })} aria-label="Posteo siguiente">
                    ›
                  </button>
                )}
              </div>
            )}

            {screen.at === "historia" && stories[screen.i] && (
              <div className="igd-modal dark">
                <div className="igd-story">
                  <IgStory
                    key={screen.i}
                    stories={stories}
                    index={screen.i}
                    user={user}
                    avatar={avatar(28)}
                    onIndex={(i) => setScreen(i < 0 || i >= stories.length ? { at: "perfil" } : { at: "historia", i })}
                    onClose={() => setScreen({ at: "perfil" })}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <span className="igd-stand" aria-hidden />
      <span className="igd-foot" aria-hidden />
    </div>
  );
}

function IgHighlights({ stories, onOpen }: { stories: BoardApp[]; onOpen: (i: number) => void }) {
  if (!stories.length) return null;
  return (
    <div className="ig-highlights">
      {stories.map((s, i) => (
        <button key={s.index} type="button" onClick={() => onOpen(i)}>
          <span className="ig-ring">
            {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage. */}
            <img src={s.url} alt="" />
          </span>
          <small>{s.name}</small>
        </button>
      ))}
    </div>
  );
}

function LikeButton({ liked, onLike }: { liked: boolean; onLike: () => void }) {
  return (
    <button type="button" className={liked ? "on" : undefined} onClick={onLike} aria-label={liked ? "Quitar me gusta" : "Me gusta"} aria-pressed={liked}>
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
        <path
          d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.8 4.5c2.2 0 3.6 1.2 5.2 3 1.6-1.8 3-3 5.2-3 3.8 0 5.9 3.9 4.4 7.3C19.5 16.4 12 21 12 21z"
          fill={liked ? "#ed4956" : "none"}
          stroke={liked ? "#ed4956" : "currentColor"}
          strokeWidth="1.8"
        />
      </svg>
    </button>
  );
}

function IgStory({
  stories,
  index,
  user,
  avatar,
  onIndex,
  onClose,
}: {
  stories: BoardApp[];
  index: number;
  user: string;
  avatar: React.ReactNode;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const [paused, setPaused] = useState(false);
  const item = stories[index];
  useEffect(() => {
    if (paused) return;
    const t = setTimeout(() => onIndex(index + 1), STORY_MS);
    return () => clearTimeout(t);
  }, [index, paused, onIndex]);
  return (
    <div
      className="ig-story"
      onPointerDown={() => setPaused(true)}
      onPointerUp={(e) => {
        setPaused(false);
        const r = e.currentTarget.getBoundingClientRect();
        if ((e.target as HTMLElement).closest("button")) return;
        onIndex(e.clientX - r.left < r.width / 3 ? index - 1 : index + 1);
      }}
      onPointerLeave={() => setPaused(false)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage. */}
      <img src={item.url} alt={item.name} draggable={false} />
      <div className="ig-bars">
        {stories.map((s, i) => (
          <span key={s.index}>
            <i className={i < index ? "done" : i === index ? `run${paused ? " paused" : ""}` : undefined} style={{ animationDuration: `${STORY_MS}ms` }} />
          </span>
        ))}
      </div>
      <div className="ig-story-head">
        {avatar}
        <b>{user}</b>
        <button type="button" onClick={onClose} aria-label="Cerrar historia">
          ×
        </button>
      </div>
    </div>
  );
}

// ---------- Mesa de trabajo ----------

type TablePos = { x: number; y: number; r: number; z: number };

// Desparramadas: posiciones "al azar" pero fijas para cada pieza (semilla = índice).
function scatter(n: number, seed: number): TablePos[] {
  const rand = (k: number) => {
    const v = Math.sin((k + 1) * 12.9898 + seed * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };
  const cols = Math.ceil(Math.sqrt(n * 1.6));
  const rows = Math.ceil(n / cols);
  return Array.from({ length: n }, (_, i) => ({
    x: ((i % cols) + 0.5) / cols * 100 + (rand(i) - 0.5) * (60 / cols),
    y: (Math.floor(i / cols) + 0.5) / rows * 100 + (rand(i + 50) - 0.5) * (50 / rows),
    r: (rand(i + 100) - 0.5) * 18,
    z: i + 1,
  }));
}

function ordered(n: number): TablePos[] {
  const cols = Math.ceil(Math.sqrt(n * 1.6));
  const rows = Math.ceil(n / cols);
  return Array.from({ length: n }, (_, i) => ({ x: ((i % cols) + 0.5) / cols * 100, y: (Math.floor(i / cols) + 0.5) / rows * 100, r: 0, z: i + 1 }));
}

function WorkTable({ items, ratios, onZoom }: { items: BoardApp[]; ratios: Record<string, number>; onZoom: (a: BoardApp) => void }) {
  const n = items.length;
  const [seed, setSeed] = useState(1);
  const [pos, setPos] = useState<TablePos[]>(() => scatter(n, 1));
  const [lifted, setLifted] = useState<number | null>(null);
  const table = useRef<HTMLDivElement>(null);
  const drag = useRef<{ i: number; dx: number; dy: number } | null>(null);
  const top = useRef(n + 1);
  // Si cambia la cantidad (se quitó una), se vuelven a desparramar.
  const [count, setCount] = useState(n);
  if (count !== n) {
    setCount(n);
    setPos(scatter(n, seed));
  }
  const size = n <= 3 ? 30 : n <= 6 ? 24 : n <= 10 ? 19 : 16;

  const raise = (i: number) => {
    top.current += 1;
    const z = top.current;
    setPos((p) => p.map((q, k) => (k === i ? { ...q, z } : q)));
  };

  return (
    <div className="wt">
      <div ref={table} className="wt-table" onPointerDown={(e) => e.target === e.currentTarget && setLifted(null)}>
        {items.map((a, i) => {
          const q = pos[i] ?? { x: 50, y: 50, r: 0, z: 1 };
          const ratio = ratios[a.url] ?? 1;
          return (
            <div
              key={a.index}
              className={`wt-piece${lifted === i ? " lifted" : ""}`}
              style={
                {
                  left: `${q.x}%`,
                  top: `${q.y}%`,
                  width: `${ratio < 1 ? size * Math.max(ratio, 0.6) : size}%`,
                  zIndex: lifted === i ? 9999 : q.z,
                  "--r": `${lifted === i ? 0 : q.r}deg`,
                } as CSSProperties
              }
              onPointerDown={(e) => {
                const box = table.current!.getBoundingClientRect();
                drag.current = { i, dx: e.clientX - (box.left + (q.x / 100) * box.width), dy: e.clientY - (box.top + (q.y / 100) * box.height) };
                e.currentTarget.setPointerCapture(e.pointerId);
                raise(i);
                setLifted(i);
              }}
              onPointerMove={(e) => {
                if (!drag.current || drag.current.i !== i) return;
                const box = table.current!.getBoundingClientRect();
                const x = Math.min(98, Math.max(2, ((e.clientX - drag.current.dx - box.left) / box.width) * 100));
                const y = Math.min(96, Math.max(4, ((e.clientY - drag.current.dy - box.top) / box.height) * 100));
                setPos((p) => p.map((v, k) => (k === i ? { ...v, x, y } : v)));
              }}
              onPointerUp={() => {
                drag.current = null;
              }}
              onDoubleClick={() => onZoom(a)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onZoom(a);
              }}
              tabIndex={0}
              role="button"
              aria-label={`${a.name}: arrastrá para mover, Enter para verla grande`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de Storage. */}
              <img src={a.url} alt={a.name} draggable={false} />
              <span className="wt-name">{a.name}</span>
            </div>
          );
        })}
      </div>
      <div className="wt-bar">
        <button
          type="button"
          className="act-btn"
          onClick={() => {
            setLifted(null);
            setPos(ordered(n));
          }}
        >
          <Icon name="grid" size={14} strokeWidth={2} />
          <span>Ordenar</span>
        </button>
        <button
          type="button"
          className="act-btn"
          onClick={() => {
            const next = seed + 1;
            setSeed(next);
            setLifted(null);
            setPos(scatter(n, next));
          }}
        >
          <Icon name="refresh" size={14} strokeWidth={2} />
          <span>Desparramar</span>
        </button>
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
        <img key={item.index} src={item.url} alt={item.name} draggable={false} />
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
// ícono del tipo; tocar la tarjeta abre el archivo.
function FilesPanel({ clientId, files, internal }: { clientId: string; files: BoardFile[]; internal: boolean }) {
  return (
    <>
      {files.length ? (
        <div className="dv-files">
          {files.map((a) => {
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
                  <span>
                    {k.label} · {a.size}
                  </span>
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
      {internal && (
        <div className="bb-actions">
          <AssetUploader clientId={clientId} kind="fuente" label="Subir tipografías" />
          <AssetUploader clientId={clientId} kind="otro" label="Subir otros" />
        </div>
      )}
    </>
  );
}
