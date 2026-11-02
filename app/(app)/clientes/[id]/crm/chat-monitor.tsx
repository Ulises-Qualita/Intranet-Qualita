import { Icon } from "@/components/icons";
import { Card, EmptyState } from "@/components/ui";
import { type ChatEvent, duration, replyTurns, type StageEvent, turnStats, WORK_HOURS } from "@/lib/crm-chats";
import type { Lead } from "@/lib/data";
import { type Period, periodPhrase } from "@/lib/period";

// Etapas que no se muestran en "Tiempo de respuesta por etapa" (pedido del usuario):
// "Incoming leads" es la bandeja de entrada de Kommo, antes de que alguien tome el
// lead, y "No contesta" es cuando el que no responde es el cliente. Se comparan sin
// mayúsculas ni tildes.
const normalize = (s: string) => s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const HIDDEN_STAGES = ["incoming leads", "no contesta"];

const time = (seconds: number | null) => (seconds === null ? "—" : duration(seconds));

// Chats del CRM (solo equipo, solo Kommo): cuánto tardan en responder según la
// etapa en la que estaba el lead cuando escribió. Sale del registro de mensajes
// sin texto (lib/crm-chats.ts). Las cards "Atención por chat" (primera respuesta
// por responsable) y "Esperando respuesta" se sacaron a pedido.
//
// `events`: null si falta crear la tabla. `leads`: las oportunidades que cuentan.
export function ChatMonitor({
  events,
  leads,
  stages,
  stageOrder,
  stageError,
  range,
  error,
}: {
  events: ChatEvent[] | null;
  leads: Lead[];
  // Historial de cambios de etapa (null = falta docs/sql/2026-10-22-crm-etapas.sql)
  // y el orden del embudo, para la tabla por etapa.
  stages: StageEvent[] | null;
  stageOrder?: string[];
  stageError: string | null;
  range: Period;
  error: string | null;
}) {
  if (events === null) {
    return (
      <Card title="Tiempo de respuesta por etapa" className="mt-4">
        <EmptyState label="Pendiente">Falta correr docs/sql/2026-10-01-crm-chats.sql en Supabase.</EmptyState>
      </Card>
    );
  }

  // Por etapa: cada vez que el cliente escribió (y esperó respuesta) en el período,
  // con la etapa en la que estaba el lead en ese momento.
  const turns = stages ? replyTurns(events, { leads, period: range, stages }) : [];
  const byStage = new Map<string, typeof turns>();
  for (const t of turns) {
    const key = t.stage || "Sin etapa";
    const list = byStage.get(key);
    if (list) list.push(t);
    else byStage.set(key, [t]);
  }
  const order = stageOrder ?? [];
  const rank = (s: string) => (order.indexOf(s) === -1 ? order.length : order.indexOf(s));
  const stageRows = [...byStage]
    .filter(([name]) => !HIDDEN_STAGES.includes(normalize(name)))
    .sort(([a, ta], [b, tb]) => rank(a) - rank(b) || tb.length - ta.length)
    .map(([name, list]) => ({ name, ...turnStats(list) }));
  // Verde hasta 15 min, amarillo hasta 1 h, rojo más.
  const tone = (seconds: number) => (seconds <= 15 * 60 ? "fast" : seconds <= 3600 ? "mid" : "slow");

  const stageCard = (
    <Card
      title="Tiempo de respuesta por etapa"
      // El horario con el que se separa "en horario laboral" de "fuera de horario laboral".
      action={
        <span className="hint chat-hours">
          <Icon name="clock" size={13} strokeWidth={2} />
          Horario laboral: {WORK_HOURS.label}
        </span>
      }
      className="mt-4"
    >
      {error && <p className="form-error">No se pudieron actualizar los chats: {error}</p>}
      {stageError && <p className="form-error">No se pudo actualizar el historial de etapas: {stageError}</p>}
      {stages === null ? (
        <EmptyState label="Pendiente">Falta correr docs/sql/2026-10-22-crm-etapas.sql en Supabase.</EmptyState>
      ) : turns.length === 0 ? (
        <EmptyState label="Sin datos">Ningún cliente escribió {periodPhrase(range)}.</EmptyState>
      ) : (
        <>
          <div className="stage-speed-grid">
            {stageRows.map((s) => (
              <div key={s.name} className="stage-speed">
                <span className="name" title={s.name}>
                  {s.name}
                </span>
                <b className={`time${s.median !== null ? ` ${tone(s.median)}` : ""}`}>{time(s.median)}</b>
                <div className="hours">
                  <span>
                    En horario laboral <b>{time(s.medianInHours)}</b>
                  </span>
                  <span>
                    Fuera de horario laboral <b>{time(s.medianOffHours)}</b>
                  </span>
                </div>
              </div>
            ))}
          </div>
          <p className="hint-text chat-notes">
            El tiempo grande es el típico: la mitad de las veces le contestan más rápido y la otra mitad, más lento. La
            etapa es la que tenía el lead cuando escribió.
          </p>
        </>
      )}
    </Card>
  );

  return stageCard;
}
