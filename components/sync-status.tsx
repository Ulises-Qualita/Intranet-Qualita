import { syncedAt } from "@/lib/format";

// Estado de la fuente de datos de una solapa, arriba de las cards: punto verde
// si la última actualización salió bien, rojo si falló, gris si todavía no se
// sincronizó nunca. `at` es la última sincronización buena (Meta, CRM, Clarity);
// `live` marca las fuentes que se leen en el momento (Notion, Calendar).
// `children` va a la derecha (p. ej. el botón de actualizar).
//
// El detalle del error es para el equipo (`internal`): la cuenta del cliente ve
// el punto rojo y "No se pudo actualizar", sin mensajes técnicos.
export function SyncStatus({
  source,
  at,
  live = false,
  error,
  internal,
  children,
}: {
  source: string;
  at?: string | null;
  live?: boolean;
  error?: React.ReactNode;
  internal: boolean;
  children?: React.ReactNode;
}) {
  const state = error ? "error" : at || live ? "ok" : "idle";

  return (
    <div className="sync-status">
      <div className={`sync-line ${state}`} role="status">
        <span className="sync-dot" aria-hidden />
        <b>{source}</b>
        <span className="sync-detail">
          {state === "error" ? (
            <>
              No se pudo actualizar
              {at && !live && <span className="sync-last">, último dato {syncedAt(at)}</span>}
            </>
          ) : live ? (
            "En vivo"
          ) : at ? (
            `Actualizado ${syncedAt(at)}`
          ) : (
            "Todavía sin sincronizar"
          )}
        </span>
      </div>
      {children && <div className="sync-actions">{children}</div>}
      {internal && error && <p className="sync-error">{error}</p>}
    </div>
  );
}
