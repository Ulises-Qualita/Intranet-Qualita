"use client";

import { useActionState, useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { Card, Pill } from "@/components/ui";
import { UserAvatar } from "@/components/user-avatar";
import { AREAS, type AreaKey, type Role } from "@/lib/auth-shared";
import type { TeamMember } from "@/lib/data";
import { addMember, updateUserAccess } from "./actions";

type Patch = { id: string; role?: Role; areas?: Record<AreaKey, boolean>; active?: boolean };

const fullAreas = (m: TeamMember) =>
  Object.fromEntries(AREAS.map(([k]) => [k, m.areas?.[k] === true])) as Record<AreaKey, boolean>;

function AddMemberForm() {
  const [state, formAction, pending] = useActionState(addMember, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <Card title="Agregar al equipo" hint="Solo correos @qualita.studio" className="mb-4">
      <form ref={formRef} action={formAction} className="invite-row">
        <input name="email" type="email" required placeholder="nombre@qualita.studio" autoComplete="off" />
        <button type="submit" className="connect-btn" disabled={pending}>
          {pending ? "Agregando…" : "Agregar"}
        </button>
      </form>
      {state?.error && <p className="form-error form-msg">{state.error}</p>}
      {state?.ok && (
        <p className="form-ok form-msg">Agregado. Ya podés darle acceso a sus áreas; entra con su cuenta de Google.</p>
      )}
    </Card>
  );
}

export function UsersAdmin({
  members,
  currentUserId,
  canEdit,
}: {
  members: TeamMember[];
  currentUserId: string;
  canEdit: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [optimistic, applyOptimistic] = useOptimistic(members, (state, { id, role, areas, active }: Patch) =>
    state.map((m) =>
      m.id === id ? { ...m, role: role ?? m.role, areas: areas ?? m.areas, active: active ?? m.active } : m,
    ),
  );

  function save(patch: Patch) {
    setError(null);
    startTransition(async () => {
      applyOptimistic(patch);
      const { id, ...changes } = patch;
      const result = await updateUserAccess(id, changes);
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <>
      {canEdit && <AddMemberForm />}

      <Card
        title="Usuarios y accesos"
        hint={canEdit ? "Activá o desactivá el acceso a cada área. El rol Admin ve todo." : "Solo un usuario con rol Admin puede editar."}
      >
        {error && <p className="form-error">{error}</p>}
        <div className="table-wrap">
          <table className="ctable">
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Rol</th>
                <th>Estado</th>
                <th>Acceso a áreas</th>
              </tr>
            </thead>
            <tbody>
              {optimistic.map((m) => {
                const isSelf = m.id === currentUserId;
                const isAdmin = m.role === "admin";
                const areas = fullAreas(m);
                return (
                  <tr key={m.id}>
                    <td>
                      <div className="cl-cell">
                        <UserAvatar className="av user-av" name={m.name} avatarUrl={m.avatarUrl} />
                        <div>
                          <b>{m.name}</b>
                          <span>{m.email}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <select
                        className="role-sel"
                        value={m.role}
                        aria-label={`Rol de ${m.name}`}
                        disabled={!canEdit || isSelf}
                        title={isSelf ? "No podés cambiar tu propio rol" : undefined}
                        onChange={(e) => save({ id: m.id, role: e.target.value as Role })}
                      >
                        <option value="member">Miembro</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td>
                      <div className="status-cell">
                        {!m.active ? (
                          <Pill variant="pausado">Inactivo</Pill>
                        ) : m.invited ? (
                          <Pill variant="onboarding">Sin ingresar</Pill>
                        ) : (
                          <Pill variant="al-dia">Activo</Pill>
                        )}
                        {canEdit && !isSelf && (
                          <button type="button" className="link-connect" onClick={() => save({ id: m.id, active: !m.active })}>
                            {m.active ? "Desactivar" : "Activar"}
                          </button>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="chips">
                        {AREAS.map(([key, label]) => (
                          <button
                            key={key}
                            type="button"
                            className={`chip${isAdmin || areas[key] ? " on" : ""}`}
                            disabled={!canEdit || isAdmin}
                            title={isAdmin ? "El rol Admin ve todas las áreas" : undefined}
                            aria-pressed={isAdmin || areas[key]}
                            onClick={() => save({ id: m.id, areas: { ...areas, [key]: !areas[key] } })}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
