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
        {series.map((s, i) =>
          s.data.map((v, j) => <circle key={`c${i}-${j}`} cx={x(j)} cy={y(v)} r="3" fill={s.color} />),
        )}
      </svg>
      {labels && labels.length > 1 && (
        <div className="chart-axis">
          <span>{labels[0]}</span>
          <span>{labels[labels.length - 1]}</span>
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

export function Funnel({ stages }: { stages: { name: string; value: number }[] }) {
  const top = Math.max(1, ...stages.map((s) => s.value));
  return (
    <div className="funnel">
      {stages.map((s) => {
        const pct = Math.round((s.value / top) * 100);
        return (
          <div className="stage" key={s.name}>
            <div className="name">{s.name}</div>
            <div className="track">
              <div className="fill" style={{ width: `${pct}%` }}>
                <b>{s.value}</b>
              </div>
            </div>
            <div className="pct">{pct}%</div>
          </div>
        );
      })}
    </div>
  );
}
