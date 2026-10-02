import { NoAccess } from "@/components/ui";
import { getAiUsage } from "@/lib/agent/usage";
import { getAreaSession } from "@/lib/auth";
import { getTeam } from "@/lib/data";
import { AiUsageCards } from "../../agent-usage";

export default async function AdminGastosPage() {
  const session = await getAreaSession("admin");
  if (!session) return <NoAccess />;

  // El equipo, solo para ponerle nombre a cada usuario del consumo.
  const [members, usage] = await Promise.all([getTeam(), getAiUsage()]);

  return (
    <section className="view">
      <AiUsageCards usage={usage} members={members} />
    </section>
  );
}
