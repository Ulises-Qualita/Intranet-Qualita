import { ThemeToggle } from "./theme-toggle";

export function Topbar({ crumb, title, children }: { crumb: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="topbar">
      <div>
        <div className="crumb">
          <b>{crumb}</b> <span>/ {title}</span>
        </div>
        <h1>{title}</h1>
      </div>
      <div className="spacer" />
      {children}
      {/* Acá y no en la sidebar: en móvil la sidebar se oculta y el toggle
          quedaba inalcanzable. */}
      <ThemeToggle />
    </div>
  );
}
