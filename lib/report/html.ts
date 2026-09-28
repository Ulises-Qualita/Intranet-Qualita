// HTML del reporte: mismo diseño y marcado que docs/DML_reporte_mensual_5.html,
// pero renderizado en el server con los datos del período (sin el bloque DATA
// ni el JS que lo dibujaba). El archivo es autónomo: estilos inline, miniaturas
// embebidas y solo las fuentes de Google por fuera.
//
// Las secciones sin datos se omiten; Google Ads figura como pendiente.
import type { ReportData, ReportKpi } from "./data";
import type { ReportTexts } from "./ai";
import { REPORT_CSS } from "./styles";

// Agregados a la referencia, que tenía nombres de creativos cortos: un nombre
// largo sin espacios se corta en dos renglones en vez de pisar al de al lado.
const EXTRA_CSS = `.cre-meta .ang{overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}`;

const LOC = "es-AR";
const money = (n: number) =>
  new Intl.NumberFormat(LOC, { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n || 0);
const int = (n: number) => new Intl.NumberFormat(LOC, { maximumFractionDigits: 0 }).format(n || 0);
const pct = (n: number) =>
  new Intl.NumberFormat(LOC, { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const dec = (n: number, d = 1) => new Intl.NumberFormat(LOC, { maximumFractionDigits: d }).format(n);
const compact = (n: number) =>
  n >= 1000 ? `${new Intl.NumberFormat(LOC, { maximumFractionDigits: 1 }).format(n / 1000)}K` : int(n);

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// Texto de Claude: se escapa y solo se respeta la **negrita**.
const rich = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong style="color:var(--ink)">$1</strong>');

const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat(LOC, { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

function hbar(nm: string, vv: string, frac: number) {
  return (
    `<div class="hbar"><div class="r"><span class="nm">${esc(nm)}</span><span class="vv">${vv}</span></div>` +
    `<div class="track"><div class="fillv" style="width:${Math.max(3, frac * 100)}%"></div></div></div>`
  );
}

const maxOf = (values: number[]) => Math.max(1, ...values);

// ---------- Parte 1 · Pauta ----------

function pauta(data: ReportData, texts: ReportTexts | null) {
  const m = data.meta;
  if (!m) return "";
  const cpl = m.leads ? m.spend / m.leads : 0;
  const ctr = m.impressions ? m.clicks / m.impressions : 0;
  const cpm = m.impressions ? (m.spend / m.impressions) * 1000 : 0;
  const cpc = m.clicks ? m.spend / m.clicks : 0;

  const kpis = `
  <div class="section">
    <span class="eyebrow">Métricas madre · Leads</span>
    <div class="kpis">
      <div class="kpi hero-kpi">
        <div class="lbl">Inversión total</div>
        <div class="val tnum">${money(m.spend)}</div>
        <div class="sub">CPM ${money(cpm)} · CPC ${money(cpc)}</div>
      </div>
      <div class="kpi hero-kpi">
        <div class="lbl">Leads generados</div>
        <div class="val tnum">${int(m.leads)}</div>
        <div class="sub">${m.campaigns.length} ${m.campaigns.length === 1 ? "campaña activa" : "campañas activas"}</div>
      </div>
      <div class="kpi hero-kpi">
        <div class="lbl">CPL · Costo por lead</div>
        <div class="val tnum" style="color:var(--violet)">${m.leads ? money(cpl) : "—"}</div>
        <div class="sub">Meta ${m.leads ? money(cpl) : "—"} · Google pendiente</div>
      </div>
    </div>
    <div class="kpi-sec">
      <div class="kpi"><div class="lbl">Impresiones</div><div class="val tnum">${int(m.impressions)}</div></div>
      <div class="kpi"><div class="lbl">Clics</div><div class="val tnum">${int(m.clicks)}</div></div>
      <div class="kpi"><div class="lbl">CTR</div><div class="val tnum">${pct(ctr)}</div></div>
      <div class="kpi"><div class="lbl">CPM</div><div class="val tnum">${money(cpm)}</div></div>
    </div>
  </div>`;

  // Google Ads todavía no está conectado: la comparación queda armada y lo marca como pendiente.
  const plataformas = `
  <div class="section">
    <span class="eyebrow">Comparación por plataforma</span>
    <h2 class="section-title">Meta Ads vs Google Ads</h2>
    <div class="grid2">
      <div class="card">
        <h3>Distribución de inversión y leads</h3>
        <div class="sharerow">
          <div class="toplbl"><span>Inversión</span><span class="tnum">${money(m.spend)}</span></div>
          <div class="bar"><div class="seg meta" style="width:100%">100%</div></div>
        </div>
        <div class="sharerow">
          <div class="toplbl"><span>Leads</span><span class="tnum">${int(m.leads)} leads</span></div>
          <div class="bar"><div class="seg meta" style="width:100%">100%</div></div>
        </div>
        <div class="legend">
          <span><span class="dot" style="background:var(--meta)"></span>Meta Ads</span>
          <span><span class="dot" style="background:var(--google)"></span>Google Ads · pendiente</span>
        </div>
      </div>
      <div class="card">
        <h3>CPL por plataforma</h3>
        <div class="cplbar"><div class="row"><span class="name"><span class="dot" style="background:var(--meta)"></span>Meta Ads</span><span class="amt tnum">${m.leads ? money(cpl) : "—"}</span></div><div class="track"><div class="fill meta" style="width:100%"></div></div></div>
        <div class="cplbar"><div class="row"><span class="name"><span class="dot" style="background:var(--google)"></span>Google Ads</span><span class="amt tnum" style="color:var(--ink-3)">Pendiente</span></div><div class="track"></div></div>
        <div class="hint">Google Ads todavía no está conectado a la intranet: cuando se conecte, esta comparación se completa sola. Barra más corta = mejor CPL.</div>
      </div>
    </div>
  </div>`;

  const sorted = [...m.campaigns].sort((a, b) => b.leads - a.leads);
  const maxLeads = maxOf(sorted.map((r) => r.leads));
  const cpls = sorted.map((r) => (r.leads ? r.spend / r.leads : Infinity));
  const minCpl = Math.min(...cpls);
  const maxCpl = Math.max(...cpls.filter(Number.isFinite));
  const rows = sorted
    .map((r) => {
      const c = r.leads ? r.spend / r.leads : 0;
      const w = Math.max(3, (r.leads / maxLeads) * 64);
      let pill = "";
      if (r.leads > 0 && c === minCpl && sorted.length > 1) pill = ' <span class="pill best">mejor CPL</span>';
      else if (r.leads > 0 && c === maxCpl && sorted.length > 1) pill = ' <span class="pill worst">CPL alto</span>';
      return (
        "<tr>" +
        `<td class="camp">${esc(r.name)}<div class="plat-tag"><span class="dot" style="background:var(--meta)"></span>Meta Ads</div></td>` +
        `<td>${money(r.spend)}</td>` +
        `<td class="leadwrap"><div class="leadcell"><span class="leadbar" style="width:${w}px"></span><span>${int(r.leads)}</span></div></td>` +
        `<td>${r.leads ? money(c) : "—"}${pill}</td>` +
        `<td>${pct(r.impressions ? r.clicks / r.impressions : 0)}</td>` +
        "<td></td>" +
        "</tr>"
      );
    })
    .join("");
  const tabla = `
  <div class="section">
    <span class="eyebrow">Detalle</span>
    <h2 class="section-title">Leads por campaña</h2>
    <div class="card" style="padding:8px 10px">
      <table>
        <thead>
          <tr>
            <th>Campaña</th><th>Inversión</th><th>Leads</th><th>CPL</th><th>CTR</th><th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td>Total</td><td>${money(m.spend)}</td><td>${int(m.leads)}</td><td>${m.leads ? money(cpl) : "—"}</td><td>${pct(ctr)}</td><td></td></tr></tfoot>
      </table>
    </div>
  </div>`;

  const notas = texts?.reading
    ? `
  <div class="section notes">
    <span class="eyebrow">Lectura del período</span>
    <h2 class="section-title">Notas y próximos pasos</h2>
    <p>${rich(texts.reading)}</p>
  </div>`
    : "";

  return kpis + plataformas + tabla + notas + creativos(data);
}

// Nomenclatura de anuncios del estudio: CLIENTE_..._<ÁNGULO>_<VID|IMG>_<versión>_<código>,
// p. ej. DML_COC_A01_D01_FUNCIONALIDAD_VID_V02_NAT03 → "Ángulo · Funcionalidad" y
// "NAT03", como en el reporte de referencia. Un nombre que no la sigue se muestra
// tal cual (el CSS lo corta en dos renglones).
const FORMAT_TOKENS = /^(VID|VIDEO|IMG|IMAGEN|IMAGE|CAR|CARRUSEL|REEL|STORY|UGC)$/i;
function creativeLabel(name: string) {
  const parts = name.trim().split("_");
  if (parts.length < 4 || /\s/.test(name)) return null;
  const code = parts[parts.length - 1];
  const angle = parts
    .slice(1, -1)
    .filter((p) => /^[A-ZÁÉÍÓÚÑ]{4,}$/i.test(p) && !FORMAT_TOKENS.test(p))
    .sort((a, b) => b.length - a.length)[0];
  if (!angle) return null;
  return { angle: angle.charAt(0).toUpperCase() + angle.slice(1).toLowerCase(), code };
}

function creativos(data: ReportData) {
  const groups = data.meta?.creativeGroups ?? [];
  if (!groups.length) return "";
  const html = groups
    .map((g, gi) => {
      const withCpl = g.ads.filter((a) => a.cpl !== null);
      const best = g.ads.length > 1 && withCpl.length ? Math.min(...withCpl.map((a) => a.cpl!)) : null;
      const phones = g.ads
        .map((a, i) => {
          const media = a.image
            ? `<img src="${a.image}" alt="${esc(a.name)}">`
            : '<div class="novid">Sin vista previa</div>';
          const kind = a.type === "video" ? "Video" : a.type === "image" ? "Imagen" : "Anuncio";
          const label = creativeLabel(a.name);
          const title = label ? `Ángulo · ${label.angle}` : a.name;
          const sub = label ? label.code : kind;
          return (
            '<div class="phone-card"><div class="phone"><div class="island"></div>' +
            (i === 0 ? '<div class="badge-top">🏆 Más leads</div>' : "") +
            `<div class="screen">${media}</div></div>` +
            `<div class="cre-meta" title="${esc(a.name)}"><div class="ang">${esc(title)}</div><div class="sub">${esc(sub)}</div></div>` +
            `<div class="cre-stats"><div class="st"><div class="n">${int(a.leads)}</div><div class="l">Leads</div></div>` +
            `<div class="st cpl"><div class="n">${a.cpl !== null ? money(a.cpl) : "—"}</div><div class="l">CPL</div></div></div>` +
            (best !== null && a.cpl === best ? '<div class="cre-bestcpl"><span>mejor CPL del grupo</span></div>' : "") +
            "</div>"
          );
        })
        .join("");
      return `
    <div class="cre-group"${gi ? ' style="margin-top:32px"' : ""}>
      <h3><span class="dot" style="background:var(--${gi ? "google" : "meta"})"></span>${esc(g.campaign)}</h3>
      <div class="phones">${phones}</div>
    </div>`;
    })
    .join("");
  return `
  <div class="section">
    <span class="eyebrow">Creativos del período</span>
    <h2 class="section-title">Los creativos que mejor performaron</h2>
    <p style="color:var(--ink-2);margin:0 0 22px;max-width:72ch">Los anuncios con más leads de las campañas principales en la ventana ${esc(data.period.range)}, con sus leads y CPL. Se muestra la portada de cada anuncio.</p>
    ${html}
  </div>`;
}

// ---------- Parte 2 · Pipeline ----------

function pulseKpi(k: ReportKpi) {
  const tag = k.up ? `<div class="tag-up">${esc(k.tag!)}</div>` : k.tag ? `<div class="tag-mut">${esc(k.tag)}</div>` : "";
  return (
    `<div class="kpi${k.up ? " hero-kpi" : ""}"><div class="val"${k.up ? ' style="color:var(--violet)"' : ""}>${esc(k.value)}</div>` +
    `<div class="sub" style="margin-top:10px;font-size:12px">${esc(k.label)}</div>${tag}</div>`
  );
}

function pipeline(data: ReportData, texts: ReportTexts | null) {
  const c = data.crm;
  if (!c) return "";
  let n = 0;
  const num = () => String(++n).padStart(2, "0");
  const parts: string[] = [];

  parts.push(`
  <div class="part-divider">
    <span class="eyebrow">Parte 2 · del clic a la venta</span>
    <h2>Pipeline comercial (CRM)</h2>
    <p>La pauta genera la demanda; el CRM la procesa. Esta parte mira qué pasó con las oportunidades una vez adentro: captación, embudo, equipo y canales. Fuente: CRM.</p>
  </div>`);

  parts.push(`
  <div class="section">
    <span class="eyebrow">${num()} · El pulso del período</span>
    <h2 class="section-title">Oportunidades captadas</h2>
    <div class="kpis k5"${c.pulse.length === 5 ? "" : ` style="grid-template-columns:repeat(${c.pulse.length},1fr)"`}>${c.pulse.map(pulseKpi).join("")}</div>
  </div>`);

  if (c.weeks.length) {
    const mw = maxOf(c.weeks.map((w) => w.value));
    const split = c.split
      ? `<div class="card"><h3>Aceleración</h3>` +
        `<div class="cstat first"><span class="cl">${esc(c.split.firstLabel)}</span><span class="cv">${int(c.split.first)}</span></div>` +
        `<div class="cstat"><span class="cl">${esc(c.split.lastLabel)}</span><span class="cv" style="color:var(--violet)">${int(c.split.last)}</span></div>` +
        `<p class="hint">${
          c.split.first
            ? c.split.last >= c.split.first
              ? `La segunda mitad del período captó ${dec(((c.split.last - c.split.first) / c.split.first) * 100, 0)}% más que la primera.`
              : `La segunda mitad del período captó ${dec(((c.split.first - c.split.last) / c.split.first) * 100, 0)}% menos que la primera.`
            : "Toda la captación se concentró en la segunda mitad del período."
        }</p></div>`
      : "";
    parts.push(`
  <div class="section">
    <span class="eyebrow">${num()} · Ritmo de captación</span>
    <h2 class="section-title">Oportunidades por semana</h2>
    <div class="grid2"${split ? "" : ' style="grid-template-columns:1fr"'}>
      <div class="card"><h3>Captación semanal</h3><div class="hbars">${c.weeks.map((w) => hbar(w.label, int(w.value), w.value / mw)).join("")}</div></div>
      ${split}
    </div>
  </div>`);
  }

  if (c.bottleneck.length) {
    const response = c.response
      ? `
    <div style="margin-top:28px">
      <span class="eyebrow" style="display:block;margin-bottom:12px">Tiempo de respuesta · Nuevo → ${esc(c.response.stage)}</span>
      <div class="kpis">
        <div class="kpi"><div class="val" style="color:var(--violet)">${dec(c.response.medianHours)}h</div><div style="font-family:var(--disp);font-weight:600;font-size:14px;color:var(--ink);margin-top:8px">Mediana de respuesta</div><div class="tag-mut">tiempo hasta el primer contacto</div></div>
        <div class="kpi"><div class="val" style="color:var(--violet)">${dec((c.response.within24 / c.response.sample) * 100, 0)}%</div><div style="font-family:var(--disp);font-weight:600;font-size:14px;color:var(--ink);margin-top:8px">Contactados en 24h</div><div class="tag-mut">${c.response.within24} de ${c.response.sample} leads</div></div>
        <div class="kpi"><div class="val" style="color:var(--violet)">${int(c.response.over3Days)}</div><div style="font-family:var(--disp);font-weight:600;font-size:14px;color:var(--ink);margin-top:8px">Tardaron +3 días</div><div class="tag-mut">mayor riesgo de enfriarse</div></div>
      </div>
      <div class="hint" style="margin-top:12px">Medido sobre los ${c.response.sample} leads del período que hoy están en ${esc(c.response.stage)}, con la fecha del último cambio de etapa.</div>
    </div>`
      : "";
    parts.push(`
  <div class="section">
    <span class="eyebrow">${num()} · El cuello de botella</span>
    <h2 class="section-title">Dónde se acumula el pipeline</h2>
    <div class="kpis"${c.bottleneck.length === 3 ? "" : ` style="grid-template-columns:repeat(${c.bottleneck.length},1fr)"`}>${c.bottleneck
      .map(
        (e) =>
          `<div class="kpi"><div class="val" style="color:var(--violet)">${int(e.count)}</div>` +
          `<div style="font-family:var(--disp);font-weight:600;font-size:14px;color:var(--ink);margin-top:8px">${esc(e.stage)}</div>` +
          `<div class="tag-mut">${dec(e.share, 0)}% del pipeline</div></div>`,
      )
      .join("")}</div>
    ${texts?.bottleneck ? `<div class="callout" style="margin-top:14px">${rich(texts.bottleneck)}</div>` : ""}
    ${response}
  </div>`);
  }

  if (c.sellers?.length) {
    const mp = Math.max(...c.sellers.map((s) => s.pct)) || 1;
    parts.push(`
  <div class="section">
    <span class="eyebrow">${num()} · El equipo</span>
    <h2 class="section-title">Quién vende</h2>
    <div class="card"><h3>% de leads que ya pasó a venta</h3>${c.sellers
      .map(
        (s) =>
          `<div class="seller"><div class="top"><span class="nm">${esc(s.name)}</span><span class="pct">${dec(s.pct)}%</span></div>` +
          `<div class="mt">${s.won} de ${s.leads} confirmadas</div><div class="track" style="height:6px"><div class="fillv" style="width:${Math.max(2, (s.pct / mp) * 100)}%"></div></div></div>`,
      )
      .join("")}</div>
  </div>`);
  }

  if (c.sources.length) {
    const mo = maxOf(c.sources.map((s) => s.leads));
    parts.push(`
  <div class="section">
    <span class="eyebrow">${num()} · De dónde llegan</span>
    <h2 class="section-title">Canal de las oportunidades</h2>
    <div class="card"><div class="hbars">${c.sources.map((s) => hbar(s.name, int(s.leads), s.leads / mo)).join("")}</div>${
      texts?.sources ? `<div class="hint">${rich(texts.sources)}</div>` : ""
    }</div>
  </div>`);
  }

  const clarity = clarityHtml(data, texts, num);
  if (clarity) parts.push(clarity);

  if (c.sales) {
    const s = c.sales;
    const ms = maxOf(s.bySource.map((x) => x.leads));
    const bySource = s.bySource.length
      ? `<div class="card" style="padding:8px 10px">
        <div style="padding:12px 12px 4px"><h3 style="margin:0">Ventas por origen <span style="font-weight:400;color:var(--ink-3);font-size:11px">— ${s.won} ${s.won === 1 ? "venta" : "ventas"}</span></h3></div>
        <div class="hbars" style="padding:8px 12px 14px">${s.bySource.map((x) => hbar(x.name, int(x.leads), x.leads / ms)).join("")}</div>
      </div>`
      : "";
    parts.push(`
  <div class="section">
    <span class="eyebrow">${num()} · Negocio · ticket y facturación</span>
    <h2 class="section-title">Ticket y facturación</h2>
    <div class="grid2"${bySource ? "" : ' style="grid-template-columns:1fr"'}>
      <div class="card now">
        <div class="who">Ventas cerradas · CRM</div>
        <div class="big-fact" style="margin-top:6px">${s.withTicket ? money(s.total) : "—"}</div>
        <div style="font-size:13px;color:var(--ink-2);margin:6px 0 10px">Facturación de ventas cerradas en el período</div>
        <div class="cstat"><span class="cl">Ventas confirmadas</span><span class="cv">${int(s.won)}</span></div>
        <div class="cstat"><span class="cl">Ventas con ticket cargado</span><span class="cv">${int(s.withTicket)}</span></div>
        <div class="cstat"><span class="cl">Ticket promedio (CRM)</span><span class="cv">${s.average !== null ? money(s.average) : "—"}</span></div>
      </div>
      ${bySource}
    </div>
  </div>`);
  }

  return parts.join("");
}

function clarityHtml(data: ReportData, texts: ReportTexts | null, num: () => string) {
  const cl = data.clarity;
  if (!cl) return "";
  const days = Math.round((Date.parse(cl.to) - Date.parse(cl.from)) / 86_400_000) + 1;
  const kpis = [
    { v: compact(cl.users), l: "Usuarios que ingresaron al sitio (suma diaria)", hi: true },
    { v: compact(cl.sessions), l: "Sesiones totales", hi: true },
    ...(cl.topPage ? [{ v: compact(cl.topPage.sessions), l: `Sesiones en ${cl.topPage.url.replace(/^https?:\/\/[^/]+/, "") || "/"}`, hi: false }] : []),
    { v: dec(cl.sessions / days, 0), l: "Sesiones por día", hi: false },
  ];
  const comp = [
    cl.pagesPerSession !== null && { n: dec(cl.pagesPerSession), l: "páginas por sesión" },
    cl.activeTime !== null && { n: `${Math.round(cl.activeTime)}s`, l: "tiempo activo por sesión" },
    cl.scroll !== null && { n: `${Math.round(cl.scroll)}%`, l: "scroll promedio" },
    cl.rageShare !== null && { n: `${dec(cl.rageShare)}%`, l: "sesiones con clics de frustración" },
  ].filter((x): x is { n: string; l: string } => !!x);

  const mt = maxOf(cl.sources.map((s) => s.share));
  const trafico = cl.sources.length
    ? `<div class="card">
        <h3>De dónde viene el tráfico</h3>
        <div class="hbars">${cl.sources.map((s) => hbar(s.name, `${Math.round(s.share)}%`, s.share / mt)).join("")}</div>
        ${texts?.traffic ? `<div class="hint">${rich(texts.traffic)}</div>` : ""}
      </div>`
    : "";
  const mobile =
    cl.mobileShare !== null
      ? `<div style="margin-top:16px">
          <div style="display:flex;justify-content:space-between;font-size:12.5px;color:var(--ink-2);margin-bottom:7px"><span>Mobile <strong style="color:var(--ink)">${Math.round(cl.mobileShare)}%</strong></span><span>Desktop <strong style="color:var(--ink)">${100 - Math.round(cl.mobileShare)}%</strong></span></div>
          <div class="bar"><div class="seg meta" style="width:${cl.mobileShare}%">${cl.mobileShare >= 14 ? "Mobile" : ""}</div><div class="seg" style="width:${100 - cl.mobileShare}%;background:var(--border-2)"></div></div>
        </div>`
      : "";
  const coverage =
    cl.from > data.period.since
      ? ` La serie arranca el ${dayLabel(cl.from)}: Clarity solo guarda datos desde que se conectó, así que cubre una parte del período.`
      : "";

  return `
  <div class="section">
    <span class="eyebrow">${num()} · Microsoft Clarity (Web)</span>
    <h2 class="section-title">Comportamiento del sitio</h2>
    <p style="color:var(--ink-2);margin:0 0 18px;max-width:74ch">Datos de Microsoft Clarity del ${dayLabel(cl.from)} al ${dayLabel(cl.to)}.${coverage}</p>
    <div class="kpi-sec" style="margin-top:0">${kpis
      .map(
        (k) =>
          `<div class="kpi"><div class="val"${k.hi ? ' style="color:var(--violet)"' : ""}>${k.v}</div>` +
          `<div class="lbl" style="margin-top:8px;font-size:12px">${esc(k.l)}</div></div>`,
      )
      .join("")}</div>
    <div class="grid2" style="margin-top:16px${trafico ? "" : ";grid-template-columns:1fr"}">
      ${trafico}
      <div class="card">
        <h3>Comportamiento en el sitio</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${comp
          .map(
            (x) =>
              '<div style="background:var(--surface-2);border:1px solid var(--border);border-radius:11px;padding:13px 14px">' +
              `<div style="font-family:var(--disp);font-weight:700;font-size:21px;color:var(--ink)">${x.n}</div>` +
              `<div style="font-size:11.5px;color:var(--ink-3);margin-top:3px;line-height:1.3">${x.l}</div></div>`,
          )
          .join("")}</div>
        ${mobile}
        ${texts?.behavior ? `<div class="hint" style="margin-top:14px">${rich(texts.behavior)}</div>` : ""}
      </div>
    </div>
  </div>`;
}

function conclusiones(texts: ReportTexts | null, crm: boolean) {
  const steps = texts?.nextSteps ?? [];
  if (!steps.length) return "";
  const nC = steps.length;
  return `
  <div class="section">
    <span class="eyebrow">${crm ? "Lo que haría la diferencia" : "Próximos pasos"}</span>
    <h2 class="section-title">Próximos pasos, por impacto</h2>
    <div class="grid2" style="grid-auto-rows:1fr">${steps
      .map((c, i) => {
        const solo = i === nC - 1 && nC % 2 === 1 ? "grid-column:1 / -1;max-width:calc(50% - 7px);margin:0 auto;" : "";
        return (
          `<div class="card" style="${solo}${c.debate ? "border-color:var(--orange)" : ""}">` +
          `<div class="eyebrow"${c.debate ? ' style="color:var(--orange-ink)"' : ""}>${esc(c.priority)}</div>` +
          `<h3 style="margin:10px 0 8px;font-size:16px">${esc(c.title)}</h3>` +
          `<p style="color:var(--ink-2);font-size:13.5px;margin:0">${rich(c.detail)}</p></div>`
        );
      })
      .join("")}</div>
  </div>`;
}

// ---------- Documento ----------

export function renderReport(data: ReportData, texts: ReportTexts | null) {
  const sources = [
    data.meta ? "Pauta (Meta · Google pendiente)" : null,
    data.crm ? "Pipeline (CRM)" : null,
    data.clarity ? "Microsoft Clarity (Web)" : null,
  ].filter(Boolean);
  const fuente = [
    data.meta ? "Meta Ads (pauta)" : null,
    data.crm ? "CRM (pipeline)" : null,
    data.clarity ? "Microsoft Clarity (Web)" : null,
  ]
    .filter(Boolean)
    .join(" + ");

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reporte ${esc(data.client.name)} · ${esc(data.period.month)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lexend:wght@500;600;700&family=DM+Sans:ital,wght@0,400;0,500;0,600;1,400&family=IBM+Plex+Mono:wght@500&display=swap">
<style>
${REPORT_CSS}
${EXTRA_CSS}
</style>
</head>
<body>
<div class="wrap">

  <div class="topbar">
    <div class="brand-line">
      <div class="logo"><span>Q</span></div>
      <div>
        <div class="eyebrow">Qualita Studio · Motor de Demanda</div>
        <div style="font-size:12px;color:var(--ink-3);margin-top:2px">Reporte de performance</div>
      </div>
    </div>
    <div class="controls">
      <button class="themebtn" id="thm">Modo oscuro</button>
    </div>
  </div>

  <div class="hero">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap">
      <div>
        <div class="eyebrow">Cliente</div>
        <h1>${esc(data.client.name)}</h1>
        <div class="meta">Período <strong>${esc(data.period.range)}</strong>${sources.length ? ` · ${sources.join(" + ")}` : ""}</div>
      </div>
    </div>
  </div>
${pauta(data, texts)}
${pipeline(data, texts)}
${conclusiones(texts, !!data.crm)}

  <div class="foot">
    <span class="sig">Preparado por Qualita Studio · Pilar 3 — Motor de Demanda · ${esc(data.client.name)} · ${esc(data.period.month)}</span>
    <span>Fuente: ${fuente || "—"} · Leads = plataforma-reported · Moneda: ARS</span>
  </div>

</div>

<script>
/* ---------- theme toggle ---------- */
(function(){
  var r=document.documentElement, b=document.getElementById('thm');
  function s(){ b.textContent = r.getAttribute('data-theme')==='dark' ? 'Modo claro' : 'Modo oscuro'; }
  b.addEventListener('click',function(){
    r.setAttribute('data-theme', r.getAttribute('data-theme')==='dark' ? 'light' : 'dark'); s();
  });
  s();
})();
</script>
</body>
</html>
`;
}
