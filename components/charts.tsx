type Series = { label: string; data: number[]; color: string; fillOpacity: number };

export function LineChart({
  id,
  series,
  labels,
  height = 230,
}: {
  id: string;
  series: Series[];
  labels?: string[];
  height?: number;
}) {
  const W = 640;
  const H = height - 20;
  const pad = 8;
  const len = Math.max(...series.map((s) => s.data.length));
  const max = Math.max(1, ...series.flatMap((s) => s.data)) * 1.15;
  const x = (i: number) => (len === 1 ? W / 2 : pad + i * ((W - pad * 2) / (len - 1)));
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2);
  const line = (a: number[]) => a.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const area = (a: number[]) => `${line(a)} L ${x(a.length - 1)} ${H - pad} L ${x(0)} ${H - pad} Z`;

  // El SVG se estira al ancho de la tarjeta (preserveAspectRatio="none"), así que
  // los círculos salen ovalados: con muchos puntos, además, se amontonan. La línea
  // no sufre porque usa vectorEffect.
  const dots = len <= 14;
  // Con muchas fechas, una marca intermedia en el eje ubica mejor.
  const axis = labels && labels.length > 8 ? [labels[0], labels[(labels.length - 1) >> 1], labels.at(-1)!] : labels;

  return (
    <>
      <svg className="chart" style={{ height }} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img">
        <defs>
          {series.map((s, i) => (
            <linearGradient key={i} id={`${id}-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={s.color} stopOpacity={s.fillOpacity} />
              <stop offset="1" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {[0, 1, 2, 3].map((i) => {
          const gy = pad + i * ((H - pad * 2) / 3);
          return <line key={i} className="grid-line" x1={pad} y1={gy} x2={W - pad} y2={gy} />;
        })}
        {series.map((s, i) => (
          <path key={`a${i}`} d={area(s.data)} fill={`url(#${id}-${i})`} />
        ))}
        {series.map((s, i) => (
          <path key={`l${i}`} d={line(s.data)} fill="none" stroke={s.color} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
        ))}
        {dots &&
          series.map((s, i) => s.data.map((v, j) => <circle key={`c${i}-${j}`} cx={x(j)} cy={y(v)} r="3" fill={s.color} />))}
      </svg>
      {axis && axis.length > 1 && (
        <div className="chart-axis">
          {axis.map((label, i) => (
            <span key={`${label}-${i}`}>{label}</span>
          ))}
        </div>
      )}
      {series.length > 1 && (
        <div className="legend">
          {series.map((s) => (
            <span key={s.label}>
              <i style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

// Etapas del pipeline como columnas: la altura es proporcional a la etapa más
// grande y el porcentaje, sobre el total, así las etapas suman 100% entre todas.
export function StageBars({ stages }: { stages: { name: string; value: number }[] }) {
  const total = stages.reduce((sum, s) => sum + s.value, 0) || 1;
  const top = Math.max(1, ...stages.map((s) => s.value));
  // Piso de altura (en % del área) para que una etapa con pocas oportunidades no
  // quede como una línea. Las alturas siguen ordenadas y se diferencian entre sí,
  // pero las chicas arrancan desde este piso en vez de desde cero.
  const floor = 8;

  return (
    <div className="stage-bars">
      {stages.map((s) => {
        const share = (s.value / total) * 100;
        // Una etapa con pocas oportunidades redondea a 0% sin estar vacía.
        const pct = share > 0 && share < 1 ? "<1%" : `${Math.round(share)}%`;
        return (
          <div className="col" key={s.name} title={`${s.name}: ${s.value} (${pct})`}>
            <b className="val">{s.value}</b>
            <div className="bar-wrap">
              <div className="bar" style={{ height: `${floor + (s.value / top) * (100 - floor)}%` }} />
            </div>
            <span className="lbl">{s.name}</span>
            <span className="share">{pct}</span>
          </div>
        );
      })}
    </div>
  );
}
