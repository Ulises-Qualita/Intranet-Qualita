import { Card, EmptyState } from "@/components/ui";
import type { AgentUsage } from "@/lib/agent/usage";
import type { TeamMember } from "@/lib/data";
import { compact, integer, relativeTime } from "@/lib/format";

// Anthropic factura en dólares, así que el gasto se muestra en dólares y no
// convertido: un tipo de cambio inventado acá sería un número que no coincide con
// ninguna factura. Los importes son chicos, de ahí los decimales.
const usd = (value: number) =>
  `US$ ${value.toLocaleString("es-AR", { minimumFractionDigits: value < 10 ? 2 : 0, maximumFractionDigits: value < 10 ? 2 : 0 })}`;

export function AgentUsageCards({ usage, members }: { usage: AgentUsage; members: TeamMember[] }) {
  const nameById = new Map(members.map((m) => [m.id, m.name]));

  // Una sola card, a todo el ancho: en la grilla de dos columnas quedaría el hueco
  // de la segunda al aire.
  if (usage.sinTabla) {
    return (
      <div className="grid mt-4">
        <Card title="Gasto de Agente Q">
          <EmptyState label="Sin configurar">
            Falta crear la tabla de consumo: correr <code>docs/sql/2026-09-18-agente-uso.sql</code> en Supabase.
          </EmptyState>
        </Card>
      </div>
    );
  }

  const { total, porUsuario } = usage;
  // El promedio por consulta ubica mejor que el total: dice si una pregunta sale
  // centavos o dólares.
  const promedio = total.consultas ? total.costUsd / total.consultas : 0;

  return (
    <div className="grid g-2-1 mt-4">
      <Card title="Gasto de Agente Q" hint={`Últimos ${usage.dias} días`}>
        {total.consultas ? (
          <>
            <div className="usage-total">
              <b>{usd(total.costUsd)}</b>
              <span>
                {integer(total.consultas)} {total.consultas === 1 ? "consulta" : "consultas"} · {usd(promedio)} por consulta
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
            <p className="usage-note">
              Estimado a partir de los tokens que devuelve la API, al precio por millón del modelo. No es la factura de
              Anthropic: no incluye el resto del consumo de la organización.
            </p>
          </>
        ) : (
          <EmptyState label="Sin datos">Todavía nadie usó Agente Q en este período.</EmptyState>
        )}
      </Card>

      <Card title="Gasto por usuario" hint={porUsuario.length ? `${porUsuario.length} en uso` : undefined}>
        {porUsuario.length ? (
          <div className="usage-people">
            {porUsuario.map((u) => (
              <div key={u.userId}>
                <div className="usage-who">
                  <b>{nameById.get(u.userId) ?? "Usuario dado de baja"}</b>
                  <span>
                    {integer(u.consultas)} {u.consultas === 1 ? "consulta" : "consultas"} · {relativeTime(u.ultima)}
                  </span>
                </div>
                <b className="usage-amount">{usd(u.costUsd)}</b>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState label="Sin datos">Nadie hizo consultas en este período.</EmptyState>
        )}
      </Card>
    </div>
  );
}
