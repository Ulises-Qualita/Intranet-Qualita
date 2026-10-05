import { NoAccess } from "@/components/ui";
import { getAiUsage } from "@/lib/agent/usage";
import { getAiConfig } from "@/lib/ai-config";
import { getAreaSession } from "@/lib/auth";
import { getTeam } from "@/lib/data";
import { AiSettings } from "../../ai-settings";
import { AiUsageCards } from "../../agent-usage";

export default async function AdminGastosPage() {
  const session = await getAreaSession("admin");
  if (!session) return <NoAccess />;

  // El equipo, solo para ponerle nombre a cada usuario del consumo.
  const [members, usage, aiConfig] = await Promise.all([getTeam(), getAiUsage(), getAiConfig()]);

  return (
    <section className="view">
      <AiSettings config={aiConfig} canEdit={session.profile?.role === "admin"} />
      <AiUsageCards usage={usage} members={members} />
    </section>
  );
}
