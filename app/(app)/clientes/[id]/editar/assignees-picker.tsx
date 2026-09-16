"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Card, EmptyState } from "@/components/ui";
import { UserAvatar } from "@/components/user-avatar";
import type { TeamMember } from "@/lib/data";
import { setClientAssignee } from "../../actions";

export function AssigneesPicker({
  clientId,
  team,
  assigneeIds,
}: {
  clientId: string;
  team: Pick<TeamMember, "id" | "name" | "email" | "avatarUrl">[];
  assigneeIds: string[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [assigned, toggleOptimistic] = useOptimistic(new Set(assigneeIds), (state, userId: string) => {
    const next = new Set(state);
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    return next;
  });

  function toggle(userId: string) {
    setError(null);
    const willAssign = !assigned.has(userId);
    startTransition(async () => {
      toggleOptimistic(userId);
      const result = await setClientAssignee(clientId, userId, willAssign);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <Card title="Responsables" hint={`${assigned.size} asignado${assigned.size === 1 ? "" : "s"}`}>
      {team.length === 0 ? (
        <EmptyState>No hay miembros activos. Agregalos desde Administración.</EmptyState>
      ) : (
        <div className="assignee-list">
          {team.map((m) => {
            const on = assigned.has(m.id);
            return (
              <button
                key={m.id}
                type="button"
                className={`assignee${on ? " on" : ""}`}
                aria-pressed={on}
                onClick={() => toggle(m.id)}
              >
                <UserAvatar className="av user-av" name={m.name} avatarUrl={m.avatarUrl} />
                <span className="assignee-txt">
                  <b>{m.name}</b>
                  <span>{m.email}</span>
                </span>
                <span className="assignee-check" aria-hidden>
                  {on ? "✓" : "+"}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {error && <p className="form-error form-msg">{error}</p>}
    </Card>
  );
}
