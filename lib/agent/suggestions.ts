// Preguntas de arranque del agente. Se arman con clientes reales del usuario:
// una sugerencia genérica ("¿cómo viene el CRM?") obliga a repreguntar de quién,
// y nombrando un cliente que existe la primera respuesta ya es útil.
//
// Sin imports de server (solo tipos): lo usan el layout y la página del agente.
import type { AreaKey } from "../auth-shared";
import type { Client } from "../data";

export function agentSuggestions(clients: Client[], access: Record<AreaKey, boolean>): string[] {
  const conectado = (provider: "crm" | "meta") => clients.find((c) => c.conn[provider])?.name;
  const crm = conectado("crm");
  const meta = conectado("meta");
  // Para tareas sirve cualquier cliente: no dependen de una integración.
  const alguno = clients[0]?.name;

  const candidatas = [
    access.crm && crm && `¿Cómo viene el CRM de ${crm} este mes?`,
    access.meta && meta && `¿Qué anuncio de ${meta} tiene el mejor CPL?`,
    access.tareas && (alguno ? `¿Qué tareas quedan pendientes de ${alguno}?` : "¿Qué tareas quedan pendientes esta semana?"),
    access.tareas && "¿Quién tiene más tareas vencidas?",
    access.equipo && "¿Cómo está repartida la carga del equipo?",
    access.clientes && "¿Qué clientes están en onboarding?",
  ];

  return candidatas.filter((s): s is string => typeof s === "string").slice(0, 3);
}
