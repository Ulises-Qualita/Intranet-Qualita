// Estilos del reporte, copiados tal cual de docs/DML_reporte_mensual_5.html (la
// referencia de diseño). No editar a mano: si cambia la referencia, volver a copiarlos.
export const REPORT_CSS = `
:root{
  --bg:#FFFFFF; --bg-alt:#F7F7FC; --surface:#FFFFFF; --surface-2:#F7F7FC;
  --ink:#1A1A2E; --ink-2:#3D3D5C; --ink-3:#6E6E8C;
  --border:#E4E4F0; --border-2:#CFCFE4;
  --brand:#252851; --brand-ink:#252851;
  --violet:#B50CC5; --violet-soft:#F6E7F8;
  --orange:#FE6F61; --orange-ink:#BE5348; --orange-soft:#FFEFEC;
  --green:#2E9E6B; --green-ink:#27865A; --green-soft:#E6F5EE;
  --shadow:0 1px 2px rgba(37,40,81,.06);
  --shadow-2:0 6px 24px rgba(37,40,81,.10);
  --disp:"Lexend",system-ui,sans-serif;
  --body:"DM Sans",system-ui,-apple-system,sans-serif;
  --mono:"IBM Plex Mono",ui-monospace,monospace;
  --meta:#B50CC5; --google:#FE6F61;
}
@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]){
    --bg:#14162E; --bg-alt:#1C1F3D; --surface:#1C1F3D; --surface-2:#252851;
    --ink:#F2F2F8; --ink-2:#B4B4CE; --ink-3:#8286AE;
    --border:#31355F; --border-2:#414672;
    --brand:#252851; --brand-ink:#8E92C8;
    --violet:#D264DE; --violet-soft:#2A1733;
    --orange:#FF8878; --orange-ink:#FF8878; --orange-soft:#33201C;
    --green:#4FC98F; --green-ink:#4FC98F; --green-soft:#16301F;
    --shadow:0 1px 2px rgba(0,0,0,.35); --shadow-2:0 8px 30px rgba(0,0,0,.45);
    --meta:#D264DE; --google:#FF8878;
  }
}
:root[data-theme="dark"]{
  --bg:#14162E; --bg-alt:#1C1F3D; --surface:#1C1F3D; --surface-2:#252851;
  --ink:#F2F2F8; --ink-2:#B4B4CE; --ink-3:#8286AE;
  --border:#31355F; --border-2:#414672;
  --brand:#252851; --brand-ink:#8E92C8;
  --violet:#D264DE; --violet-soft:#2A1733;
  --orange:#FF8878; --orange-ink:#FF8878; --orange-soft:#33201C;
  --green:#4FC98F; --green-ink:#4FC98F; --green-soft:#16301F;
  --shadow:0 1px 2px rgba(0,0,0,.35); --shadow-2:0 8px 30px rgba(0,0,0,.45);
  --meta:#D264DE; --google:#FF8878;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--body);
  font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased}
.wrap{max-width:1040px;margin:0 auto;padding:32px 28px 56px}
h1,h2,h3{font-family:var(--disp);font-weight:700;color:var(--ink);margin:0;line-height:1.15}
.eyebrow{font-family:var(--disp);font-size:11px;letter-spacing:.13em;text-transform:uppercase;
  color:var(--violet);font-weight:600}
.tnum{font-variant-numeric:tabular-nums}
.mono{font-family:var(--mono)}

/* Top bar */
.topbar{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:26px}
.brand-line{display:flex;align-items:center;gap:12px}
.logo{width:34px;height:34px;border-radius:9px;background:var(--brand);
  display:flex;align-items:center;justify-content:center;flex:0 0 auto}
.logo span{font-family:var(--disp);font-weight:700;color:#fff;font-size:16px;line-height:1}
.controls{display:flex;gap:8px;align-items:center}
.themebtn{background:var(--surface);border:1px solid var(--border-2);color:var(--ink-2);
  border-radius:20px;padding:6px 14px;font-family:var(--body);font-size:12px;cursor:pointer}
.themebtn:hover{border-color:var(--violet);color:var(--violet)}
:focus-visible{outline:2px solid var(--violet);outline-offset:2px}

/* Hero header */
.hero{border:1px solid var(--border);background:var(--surface);border-radius:16px;
  padding:26px 28px;box-shadow:var(--shadow);margin-bottom:14px;position:relative;overflow:hidden}
.hero:before{content:"";position:absolute;left:0;top:0;bottom:0;width:5px;
  background:linear-gradient(180deg,var(--violet),var(--orange))}
.hero h1{font-size:27px;margin:6px 0 4px}
.hero .meta{color:var(--ink-2);font-size:14px}
.badge{display:inline-flex;align-items:center;gap:6px;font-family:var(--disp);font-size:10.5px;
  letter-spacing:.08em;text-transform:uppercase;font-weight:600;padding:4px 10px;border-radius:999px;
  background:var(--orange-soft);color:var(--orange-ink);border:1px solid var(--orange)}

/* Section */
.section{margin-top:30px}
.section > .eyebrow{display:block;margin-bottom:12px}
.section-title{font-size:18px;margin-bottom:14px}

/* KPI tiles */
.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.kpi{border:1px solid var(--border);background:var(--surface);border-radius:14px;padding:18px 20px;
  box-shadow:var(--shadow);position:relative}
.kpi.hero-kpi{border-color:var(--border-2)}
.kpi .lbl{font-size:12px;color:var(--ink-3);font-weight:500;display:flex;align-items:center;gap:7px}
.kpi .val{font-family:var(--disp);font-weight:700;font-size:30px;margin-top:8px;letter-spacing:-.01em}
.kpi .sub{font-size:12px;color:var(--ink-2);margin-top:5px}
.dot{width:9px;height:9px;border-radius:3px;flex:0 0 auto}
.kpi-sec{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:12px}
.kpi-sec .kpi .val{font-size:21px}

/* Platform split */
.grid2{display:grid;grid-template-columns:1.15fr .85fr;gap:14px}
.card{border:1px solid var(--border);background:var(--surface);border-radius:14px;padding:20px 22px;
  box-shadow:var(--shadow)}
.card h3{font-size:14px;margin-bottom:16px;color:var(--ink)}
.sharerow{margin-bottom:18px}
.sharerow:last-child{margin-bottom:0}
.sharerow .toplbl{display:flex;justify-content:space-between;font-size:12px;color:var(--ink-2);margin-bottom:6px}
.bar{height:26px;border-radius:7px;overflow:hidden;display:flex;background:var(--surface-2)}
.bar .seg{height:100%;display:flex;align-items:center;padding:0 9px;color:#fff;font-size:12px;
  font-weight:600;font-family:var(--disp);white-space:nowrap;min-width:0}
.seg.meta{background:var(--meta)}
.seg.google{background:var(--google)}
.legend{display:flex;gap:16px;margin-top:14px;font-size:12px;color:var(--ink-2)}
.legend span{display:inline-flex;align-items:center;gap:7px}

/* CPL bars */
.cplbar{margin-bottom:16px}
.cplbar .row{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px}
.cplbar .name{font-size:13px;color:var(--ink);font-weight:500;display:flex;align-items:center;gap:7px}
.cplbar .amt{font-family:var(--disp);font-weight:700;font-size:16px}
.track{height:10px;background:var(--surface-2);border-radius:6px;overflow:hidden}
.fill{height:100%;border-radius:6px}
.fill.meta{background:var(--meta)}
.fill.google{background:var(--google)}
.hint{font-size:12px;color:var(--ink-3);margin-top:14px;line-height:1.45}

/* Table */
table{width:100%;border-collapse:collapse;font-size:13.5px}
thead th{font-family:var(--disp);font-size:11px;letter-spacing:.04em;text-transform:uppercase;
  color:var(--ink-3);font-weight:600;text-align:right;padding:9px 12px;border-bottom:2px solid var(--border-2)}
thead th:first-child,tbody td:first-child{text-align:left}
tbody td{padding:11px 12px;border-bottom:1px solid var(--border);text-align:right;
  font-variant-numeric:tabular-nums;color:var(--ink-2)}
tbody td.camp{color:var(--ink);font-weight:500;max-width:280px}
tbody tr:last-child td{border-bottom:none}
tfoot td{padding:11px 12px;font-family:var(--disp);font-weight:700;color:var(--ink);
  border-top:2px solid var(--border-2);text-align:right;font-variant-numeric:tabular-nums}
tfoot td:first-child{text-align:left}
.plat-tag{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--ink-3);margin-top:3px}
.camp-nota{font-size:11px;color:var(--violet);margin-top:4px;font-weight:600;font-family:var(--disp)}
td.leadwrap{vertical-align:middle}
.leadcell{display:flex;align-items:center;gap:9px;justify-content:flex-end}
.leadbar{height:7px;border-radius:4px;background:var(--violet);min-width:3px}
.pill{font-size:10.5px;font-family:var(--disp);font-weight:600;padding:2px 8px;border-radius:999px;letter-spacing:.02em}
.pill.best{background:var(--green-soft);color:var(--green-ink)}
.pill.worst{background:var(--orange-soft);color:var(--orange-ink)}

/* Pipeline / CRM helpers */
.kpis.k5{grid-template-columns:repeat(5,1fr)}
.tag-up{font-size:12px;color:var(--green-ink);font-weight:600;margin-top:8px;display:inline-flex;align-items:center;gap:5px}
.tag-up::before{content:"▲";font-size:8px}
.tag-mut{display:block;font-size:11px;color:var(--ink-3);text-transform:uppercase;letter-spacing:.06em;margin-top:8px}
.hbars{display:flex;flex-direction:column;gap:13px}
.hbar .r{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px}
.hbar .r .nm{font-size:13px;color:var(--ink);font-weight:500}
.hbar .r .vv{font-family:var(--disp);font-weight:700;font-size:14px;color:var(--ink);font-variant-numeric:tabular-nums}
.fillv{height:100%;border-radius:6px;background:var(--violet)}
.cstat{display:flex;justify-content:space-between;align-items:baseline;padding:12px 0;border-top:1px solid var(--border)}
.cstat.first{border-top:none;padding-top:2px}
.cstat .cl{font-size:12.5px;color:var(--ink-2)}
.cstat .cv{font-family:var(--disp);font-weight:700;font-size:21px;color:var(--ink);font-variant-numeric:tabular-nums}
.who{font-family:var(--disp);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);font-weight:600}
.whn{font-size:12.5px;color:var(--ink-3);margin:2px 0 8px}
.card.now{border-color:var(--violet)}
.card.now .who{color:var(--violet)}
.seller{padding:14px 0;border-bottom:1px solid var(--border)}
.seller:last-child{border-bottom:none}
.seller .top{display:flex;justify-content:space-between;align-items:baseline}
.seller .nm{font-family:var(--disp);font-weight:600;font-size:14px;color:var(--ink)}
.seller .pct{font-family:var(--disp);font-weight:700;font-size:15px;color:var(--violet)}
.seller .mt{font-size:12px;color:var(--ink-3);margin:4px 0 7px}
.big-fact{font-family:var(--disp);font-weight:700;font-size:clamp(30px,5vw,40px);color:var(--violet);line-height:1;font-variant-numeric:tabular-nums}
.part-divider{margin-top:40px;padding:22px 24px;border-radius:16px;border:1px solid var(--border-2);
  background:linear-gradient(160deg,var(--violet-soft),var(--surface))}
.part-divider h2{font-size:20px;margin:6px 0 6px}
.part-divider p{color:var(--ink-2);font-size:13.5px;margin:0;max-width:72ch}

/* Creativos · iPhone mockup */
.cre-group h3{font-size:13px;margin-bottom:16px;display:flex;align-items:center;gap:8px;color:var(--ink)}
.phones{display:flex;flex-wrap:wrap;gap:26px;justify-content:center}
.phone-card{width:230px}
.phone{position:relative;width:230px;aspect-ratio:9/19.5;background:#0a0b12;border-radius:34px;
  padding:8px;box-shadow:0 12px 34px rgba(37,40,81,.24);border:2px solid var(--border-2);overflow:hidden}
.phone .screen{width:100%;height:100%;border-radius:27px;overflow:hidden;background:#000;position:relative}
.phone .screen video,.phone .screen img{width:100%;height:100%;object-fit:cover;display:block}
.phone .island{position:absolute;top:11px;left:50%;transform:translateX(-50%);width:72px;height:19px;
  background:#0a0b12;border-radius:12px;z-index:3}
.phone .badge-top{position:absolute;top:14px;right:12px;z-index:3;background:var(--violet);color:#fff;
  font-family:var(--disp);font-weight:600;font-size:9.5px;padding:4px 9px;border-radius:999px;letter-spacing:.03em;
  box-shadow:0 2px 8px rgba(0,0,0,.3)}
.phone .novid{display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;gap:10px;
  color:var(--ink-3);font-size:12px;text-align:center;padding:24px;background:var(--surface-2)}
.cre-meta{padding:14px 4px 0;text-align:center}
.cre-meta .ang{font-family:var(--disp);font-weight:600;font-size:13.5px;color:var(--ink)}
.cre-meta .sub{font-size:11px;color:var(--ink-3);margin-top:2px;font-family:var(--mono)}
.cre-stats{display:flex;justify-content:center;gap:10px;margin-top:11px}
.cre-stats .st{background:var(--surface-2);border:1px solid var(--border);border-radius:11px;padding:7px 12px;text-align:center;min-width:72px}
.cre-stats .st .n{font-family:var(--disp);font-weight:700;font-size:16px;color:var(--ink);font-variant-numeric:tabular-nums}
.cre-stats .st .l{font-size:10px;color:var(--ink-3);text-transform:uppercase;letter-spacing:.05em;margin-top:1px}
.cre-stats .st.cpl .n{color:var(--violet)}
.cre-bestcpl{margin-top:8px;text-align:center}
.cre-bestcpl span{font-size:10px;font-family:var(--disp);font-weight:600;color:var(--green-ink);
  background:var(--green-soft);padding:3px 9px;border-radius:999px}

/* Notes */
.notes p{color:var(--ink-2);margin:0 0 11px}
.notes strong{color:var(--ink)}
.callout{border-left:3px solid var(--violet);background:var(--violet-soft);padding:13px 16px;
  border-radius:0 10px 10px 0;font-size:13.5px;color:var(--ink-2)}

/* Footer */
.foot{margin-top:38px;padding-top:16px;border-top:1px solid var(--border);
  font-size:12px;color:var(--ink-3);display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
.foot .sig{font-family:var(--disp);font-weight:500;color:var(--ink-2)}

@media (max-width:760px){
  .kpis{grid-template-columns:1fr}
  .kpis.k5{grid-template-columns:repeat(2,1fr)}
  .kpi-sec{grid-template-columns:repeat(2,1fr)}
  .grid2{grid-template-columns:1fr}
  .hero h1{font-size:22px}
}

/* Print → PDF */
@media print{
  @page{size:A4;margin:12mm}
  body{background:#fff;font-size:11.5px}
  .wrap{max-width:none;padding:0}
  .controls{display:none !important}
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .hero,.kpi,.card{box-shadow:none;break-inside:avoid}
  .phone-card,.phone{break-inside:avoid}
  .section{break-inside:avoid;margin-top:16px}
  table{break-inside:auto}
  tr{break-inside:avoid}
}
`;
