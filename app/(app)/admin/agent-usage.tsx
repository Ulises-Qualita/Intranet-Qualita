import { Card, EmptyState } from "@/components/ui";
import { type AiUsage, type UsageSection, USAGE_KINDS } from "@/lib/agent/usage";
import type { TeamMember } from "@/lib/data";
import { compact, integer, relativeTime } from "@/lib/format";

// Anthropic factura en dólares, así que el gasto se muestra en dólares y no
// convertido: un tipo de cambio inventado acá sería un número que no coincide con
// ninguna factura. Los importes son chicos, de ahí los decimales.
const usd = (value: number) =>
  `US$ ${value.toLocaleString("es-AR", { minimumFractionDigits: value < 10 ? 2 : 0, maximumFractionDigits: value < 10 ? 2 : 0 })}`;

const count = (n: number, [one, many]: readonly [string, string]) => `${integer(n)} ${n === 1 ? one : many}`;

// Un bloque por tipo de uso: el total del tipo y quién lo gastó.
function UsageBlock({
  section,
  dias,
  nameById,
}: {
  section: UsageSection;
  dias: number;
  nameById: Map<string, string>;
}) {
  const meta = USAGE_KINDS.find((k) => k.kind === section.kind)!;
  const { total, porUsuario } = section;
  // El promedio por uso ubica mejor que el total: dice si cada uno sale centavos o dólares.
  const promedio = total.usos ? total.costUsd / total.usos : 0;

  return (
    <div className="grid g-2-1 items-stretch mt-4">
      <Card title={`Gasto de ${meta.title}`} hint={`Últimos ${dias} días`}>
        {total.usos ? (
          <>
            <div className="usage-total">
              <b>{usd(total.costUsd)}</b>
              <span>
                {count(total.usos, meta.unit)} · {usd(promedio)} por {meta.unit[0]}
              </span>
            </div>
            <div className="usage-rows">
              <div>
                <span>Tokens de entrada</span>
                <b>{compact(total.inputTokens)}</b>
              </div>
              <div>
                <span>Tokens de salida</span>
                <b>{compact(total.outputTokens)}</b>
              </div>
              <div>
                <span>Leídos del caché</span>
                <b>{compact(total.cacheReadTokens)}</b>
              </div>
            </div>
          </>
        ) : (
          <EmptyState label="Sin datos">{meta.empty}</EmptyState>
        )}
      </Card>

      <Card title="Por usuario" hint={porUsuario.length ? `${porUsuario.length} en uso` : undefined}>
        {porUsuario.length ? (
          <div className="usage-people">
            {porUsuario.map((u) => (
              <div key={u.userId}>
                <div className="usage-who">
                  <b>{nameById.get(u.userId) ?? "Usuario dado de baja"}</b>
                  <span>
                    {count(u.usos, meta.unit)} · {relativeTime(u.ultima)}
                  </span>
                </div>
                <b className="usage-amount">{usd(u.costUsd)}</b>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState label="Sin datos">Nadie lo usó en este período.</EmptyState>
        )}
      </Card>
    </div>
  );
}

export function AiUsageCards({ usage, members }: { usage: AiUsage; members: TeamMember[] }) {
  const nameById = new Map(members.map((m) => [m.id, m.name]));

  // Una sola card, a todo el ancho: en la grilla de dos columnas quedaría el hueco
  // de la segunda al aire.
  if (usage.sinTabla) {
    return (
      <div className="grid">
        <Card title="Gasto de IA">
          <EmptyState label="Sin configurar">
            Falta crear la tabla de consumo: correr <code>docs/sql/2026-09-18-agente-uso.sql</code> en Supabase.
          </EmptyState>
        </Card>
      </div>
    );
  }

  // Sin la columna kind todo queda en el agente: los otros bloques saldrían vacíos
  // y darían a entender que no se usaron.
  const secciones = usage.sinTipo ? usage.secciones.filter((s) => s.kind === "agente") : usage.secciones;

  return (
    <>
      <div className="view-actions">
        <span className="muted">
          Gasto de IA de los últimos {usage.dias} días: <b>{usd(usage.total.costUsd)}</b>. Estimado a partir de los tokens
          que devuelve la API, al precio por millón del modelo; no es la factura de Anthropic.
        </span>
      </div>
      {usage.sinTipo && (
        <p className="usage-note">
          Todavía no se separa por tipo: correr <code>docs/sql/2026-09-28-uso-por-tipo.sql</code> en Supabase. Hasta
          entonces, los reportes figuran dentro del agente.
        </p>
      )}
      {secciones.map((s) => (
        <UsageBlock key={s.kind} section={s} dias={usage.dias} nameById={nameById} />
      ))}
    </>
  );
}
