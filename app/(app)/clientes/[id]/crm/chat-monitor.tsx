import { Card, EmptyState } from "@/components/ui";
import { type ChatEvent, chatStats, duration, NO_OWNER, WORK_HOURS } from "@/lib/crm-chats";
import type { Lead } from "@/lib/data";
import { integer, percent } from "@/lib/format";
import { type Period, periodPhrase } from "@/lib/period";

const ORIGIN_LABELS: Record<string, string> = {
  waba: "WhatsApp",
  whatsapp: "WhatsApp",
  instagram_business: "Instagram",
  instagram: "Instagram",
  facebook: "Messenger",
  telegram: "Telegram",
};
// Conversaciones esperando que se listan; el resto queda en el contador.
const WAITING_SHOWN = 10;

// Responsables que no se listan en la tabla: los leads sin responsable y los que
// quedaron a nombre de la cuenta administradora de Kommo, que no es un equipo de
// ventas. Sus conversaciones siguen contando en los totales de arriba.
const isHiddenOwner = (name: string) => name === NO_OWNER || /^admin(istrador|istrator)?$/i.test(name.trim());

const time = (seconds: number | null) => (seconds === null ? "—" : duration(seconds));
const share = (value: number | null) => (value === null ? "—" : percent(value * 100, 0));

// Atención por chat del CRM (solo equipo, solo Kommo): cuánto tarda la primera
// respuesta a cada lead nuevo, por responsable, y qué conversaciones quedaron
// esperando. Sale del registro de mensajes sin texto (lib/crm-chats.ts); los
// límites de esa fuente se aclaran al pie para que nadie lea de más en los números.
//
// `events`: null si falta crear la tabla. `leads`: las oportunidades que cuentan.
// `storedSince`: desde cuándo hay mensajes guardados. `leadUrl`: arma el link al
// lead en el CRM.
export function ChatMonitor({
  events,
  leads,
  storedSince,
  range,
  error,
  leadUrl,
}: {
  events: ChatEvent[] | null;
  leads: Lead[];
  storedSince: string | null;
  range: Period;
  error: string | null;
  leadUrl: (leadId: string) => string;
}) {
  if (events === null) {
    return (
      <Card title="Atención por chat" className="mt-4">
        <EmptyState label="Pendiente">Falta correr docs/sql/2026-10-01-crm-chats.sql en Supabase.</EmptyState>
      </Card>
    );
  }

  const { total, groups: allGroups, waiting, fromKommo } = chatStats(events, { leads, period: range, storedSince });
  const groups = allGroups.filter((g) => !isHiddenOwner(g.name));
  const hiddenTalks = allGroups.filter((g) => isHiddenOwner(g.name)).reduce((n, g) => n + g.talks, 0);

  return (
    <div className="grid g-2-1 items-stretch mt-4">
      <Card title="Atención por chat" hint={range.label}>
        {error && <p className="form-error">No se pudieron actualizar los chats: {error}</p>}
        {events.length === 0 ? (
          <EmptyState label="Sin datos">
            No hay mensajes guardados {periodPhrase(range)}. El historial se completa de a poco en cada sincronización.
          </EmptyState>
        ) : (
          <>
            <div className="usage-rows mb-4">
              <div>
                <span>Leads nuevos que escribieron</span>
                <b>{integer(total.leads)}</b>
              </div>
              <div>
                <span>Primera respuesta (mediana)</span>
                <b>{time(total.medianResponse)}</b>
              </div>
              <div>
                <span>En horario de atención</span>
                <b>{time(total.medianInHours)}</b>
              </div>
              <div>
                <span>Fuera de horario</span>
                <b>{time(total.medianOffHours)}</b>
              </div>
              <div>
                <span>Respondidos en 15 min</span>
                <b>{share(total.fastShare)}</b>
              </div>
              <div>
                <span>Sin respuesta</span>
                <b>{integer(total.unanswered)}</b>
              </div>
            </div>

            <div className="table-wrap">
              <table className="ctable">
                <thead>
                  <tr>
                    <th>Responsable</th>
                    <th>Leads nuevos</th>
                    <th>1.ª respuesta</th>
                    <th>En horario</th>
                    <th>Fuera de horario</th>
                    <th>En 15 min</th>
                    <th>Sin respuesta</th>
                    <th>Conversaciones</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.name}>
                      <td>
                        <b>{g.name}</b>
                      </td>
                      <td className="num">{integer(g.leads)}</td>
                      <td className="num">{time(g.medianResponse)}</td>
                      <td className="num">{time(g.medianInHours)}</td>
                      <td className="num">{time(g.medianOffHours)}</td>
                      <td className="num">{share(g.fastShare)}</td>
                      <td className="num">{integer(g.unanswered)}</td>
                      <td className="num">{integer(g.talks)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="hint-text chat-notes">
              La primera respuesta va del primer mensaje de cada lead nuevo {periodPhrase(range)} al primer mensaje que
              recibió después, con reloj corrido; se separa según el lead haya escrito dentro o fuera del horario de
              atención ({WORK_HOURS.label}). No entran los clientes que ya estaban ni las charlas ya empezadas. Va
              agrupado por el responsable del lead en el CRM, no por quién escribió: {integer(fromKommo)} de{" "}
              {integer(total.outgoing)} mensajes enviados salieron de un usuario de Kommo; el resto son respuestas desde
              la app de WhatsApp del teléfono, que llegan sin autor. En total hubo {integer(total.talks)} conversaciones
              con {integer(total.incoming)} mensajes recibidos.
              {hiddenTalks > 0 &&
                ` Los totales incluyen ${integer(hiddenTalks)} ${hiddenTalks === 1 ? "conversación" : "conversaciones"} sin responsable o a nombre del administrador, que no se listan en la tabla.`}
            </p>
          </>
        )}
      </Card>

      <Card title="Esperando respuesta" hint={waiting.length ? `${integer(waiting.length)} sin contestar` : undefined} className="feed-card">
        {waiting.length === 0 ? (
          <EmptyState label="Al día">Ninguna conversación del período terminó con un mensaje del cliente.</EmptyState>
        ) : (
          <div className="feed-list">
            {waiting.slice(0, WAITING_SHOWN).map((w) => (
              <div key={w.talkId} className="lead-row">
                <div className="info">
                  <b>
                    {w.leadId ? (
                      <a href={leadUrl(w.leadId)} target="_blank" rel="noreferrer" className="chat-lead">
                        {w.leadName ?? `Lead ${w.leadId}`}
                      </a>
                    ) : (
                      "Contacto sin lead"
                    )}
                  </b>
                  <span>{[w.owner, w.origin ? (ORIGIN_LABELS[w.origin] ?? w.origin) : null].filter(Boolean).join(" · ")}</span>
                </div>
                <span className="chat-wait">hace {duration(w.waited)}</span>
              </div>
            ))}
            {waiting.length > WAITING_SHOWN && (
              <p className="hint-text chat-notes">Y {integer(waiting.length - WAITING_SHOWN)} más, anteriores a estas.</p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
