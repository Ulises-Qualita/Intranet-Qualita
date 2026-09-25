// Preguntas de arranque del agente. Se arman con clientes reales del usuario:
// una sugerencia genérica ("¿cómo viene el CRM?") obliga a repreguntar de quién,
// y nombrando un cliente que existe la primera respuesta ya es útil.
//
// Sin imports de server (solo tipos): lo usan el layout y la página del agente.
import type { AreaKey } from "../auth-shared";
import type { Client } from "../data";
import { SHOW_TASKS } from "../tasks";

export function agentSuggestions(clients: Client[], access: Record<AreaKey, boolean>): string[] {
  const conectado = (provider: "crm" | "meta") => clients.find((c) => c.conn[provider])?.name;
  const crm = conectado("crm");
  const meta = conectado("meta");
  const conMeta = clients.filter((c) => c.conn.meta).length;
  // Para tareas sirve cualquier cliente: no dependen de una integración.
  const alguno = clients[0]?.name;
  // Tareas ocultas (SHOW_TASKS): el agente tampoco tiene la tool, así que no se sugieren.
  const tareas = SHOW_TASKS && access.tareas;

  // En orden de prioridad: se muestran las tres primeras que apliquen.
  const candidatas = [
    access.crm && crm && `¿Cómo viene el CRM de ${crm} este mes?`,
    access.meta && meta && `¿Qué anuncio de ${meta} tiene el mejor CPL?`,
    access.crm && crm && `¿De qué canal vienen más ventas en ${crm}?`,
    access.meta && conMeta > 1 && "Compará la inversión en Meta de los clientes este mes",
    access.crm && crm && `¿Qué vendedor de ${crm} cerró más ventas este mes?`,
    tareas && (alguno ? `¿Qué tareas quedan pendientes de ${alguno}?` : "¿Qué tareas quedan pendientes esta semana?"),
    tareas && "¿Quién tiene más tareas vencidas?",
    access.equipo && "¿Cómo está repartida la carga del equipo?",
    access.clientes && "¿Qué clientes están en onboarding?",
  ];

  return candidatas.filter((s): s is string => typeof s === "string").slice(0, 3);
}
