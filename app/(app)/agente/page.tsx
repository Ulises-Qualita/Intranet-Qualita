import { AgentConversation } from "@/components/agent/agent-conversation";
import { Topbar } from "@/components/topbar";
import { NoAccess } from "@/components/ui";
import { agentSuggestions } from "@/lib/agent/suggestions";
import { getMessages, getThread } from "@/lib/agent/threads";
import { getSession } from "@/lib/auth";
import { AREAS, canAccess, type AreaKey } from "@/lib/auth-shared";
import { getClients } from "@/lib/data";

// El agente no es de un área: consulta las que el usuario tenga habilitadas, así
// que alcanza con tener al menos una.
export default async function AgentePage({ searchParams }: { searchParams: Promise<{ hilo?: string }> }) {
  const [session, { hilo }] = await Promise.all([getSession(), searchParams]);
  const access = Object.fromEntries(AREAS.map(([k]) => [k, canAccess(session?.profile ?? null, k)])) as Record<AreaKey, boolean>;

  if (!session || !Object.values(access).some(Boolean)) {
    return (
      <>
        <Topbar crumb="Qualita" title="Agente Q" />
        <NoAccess />
      </>
    );
  }

  // Con ?hilo=… (el botón de abrir en grande) la conversación llega ya cargada.
  // La RLS filtra por dueño, así que un id ajeno devuelve una lista vacía.
  const [clients, messages, thread] = await Promise.all([
    access.clientes ? getClients() : [],
    hilo ? getMessages(hilo) : [],
    hilo ? getThread(hilo) : null,
  ]);

  return (
    <>
      <Topbar crumb="Qualita" title="Agente Q" />
      {/* view-fill: la conversación ocupa el alto libre y el único scroll es el
          del log, como en el portal del cliente. */}
      <section className="view view-fill">
        <AgentConversation
          userName={session.user.name}
          suggestions={agentSuggestions(clients, access)}
          variant="page"
          initialThreadId={messages.length ? (hilo ?? null) : null}
          initialMessages={messages.map((m) => ({ role: m.role, content: m.content, tools: m.tools ?? [] }))}
          initialTitle={messages.length ? (thread?.title ?? null) : null}
        />
      </section>
    </>
  );
}
