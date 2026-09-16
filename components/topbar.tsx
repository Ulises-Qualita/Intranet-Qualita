export function Topbar({ crumb, title }: { crumb: string; title: string }) {
  return (
    <div className="topbar">
      <div>
        <div className="crumb">
          <b>{crumb}</b> <span>/ {title}</span>
        </div>
        <h1>{title}</h1>
      </div>
    </div>
  );
}
