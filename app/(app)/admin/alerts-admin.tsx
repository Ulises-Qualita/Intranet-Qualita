"use client";

import { useState, useTransition } from "react";
import { ActionButton, ConfirmDialog } from "@/components/actions";
import { Icon } from "@/components/icons";
import {
  type AlertsResult,
  createTelegramLink,
  saveAlertRecipients,
  sendTelegramTest,
  unlinkTelegram,
  verifyTelegramLink,
} from "./alerts-actions";

type Member = { id: string; name: string; email: string; role: string; chat: string | null; pending: boolean };

// El chat de Telegram de cada persona. "Vincular" arma un link al bot: se abre
// (o se le manda a la persona), se toca «Iniciar» y después «Verificar».
export function TelegramLinks({ members, canEdit }: { members: Member[]; canEdit: boolean }) {
  const [links, setLinks] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ id: string; ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [unlinking, setUnlinking] = useState<Member | null>(null);
  const [, startTransition] = useTransition();

  const run = (id: string, action: () => Promise<AlertsResult>, okText: string) =>
    startTransition(async () => {
      setBusy(id);
      const result = await action();
      setBusy(null);
      setNotice({ id, ok: result.ok, text: result.ok ? okText : result.error });
      if (result.ok)
        setLinks((l) => {
          const next = { ...l };
          delete next[id];
          return next;
        });
    });

  const makeLink = (id: string) =>
    startTransition(async () => {
      setBusy(id);
      const result = await createTelegramLink(id);
      setBusy(null);
      if (!result.ok) return setNotice({ id, ok: false, text: result.error });
      setNotice(null);
      setLinks((l) => ({ ...l, [id]: result.url }));
    });

  return (
    <>
      <div className="table-wrap">
        <table className="ctable alerts-members">
          <thead>
            <tr>
              <th>Persona</th>
              <th>Telegram</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td>
                  <b>{m.name}</b>
                  <div className="alerts-sub">{m.email}</div>
                </td>
                <td>
                  {m.chat ? (
                    <span className="alerts-linked">
                      <Icon name="check" size={13} strokeWidth={2.4} /> {m.chat.startsWith("vinc") ? m.chat : `@${m.chat}`}
                    </span>
                  ) : (
                    <span className="alerts-sub">Sin vincular</span>
                  )}
                  {links[m.id] && (
                    <div className="alerts-linkbox">
                      <span>
                        Abrí este link en Telegram (o mandáselo a {m.name.split(" ")[0]}), tocá <b>Iniciar</b> y después
                        «Verificar»:
                      </span>
                      <a href={links[m.id]} target="_blank" rel="noopener noreferrer">
                        {links[m.id]}
                      </a>
                    </div>
                  )}
                  {notice?.id === m.id && <div className={notice.ok ? "form-ok" : "form-error"}>{notice.text}</div>}
                </td>
                <td>
                  {canEdit && (
                    <div className="alerts-actions">
                      {links[m.id] ? (
                        <ActionButton
                          icon="check"
                          disabled={busy === m.id}
                          onClick={() => run(m.id, () => verifyTelegramLink(m.id), "Vinculado. Le llegó un mensaje de confirmación.")}
                        >
                          {busy === m.id ? "Verificando…" : "Verificar"}
                        </ActionButton>
                      ) : (
                        <ActionButton icon="send" disabled={busy === m.id} onClick={() => makeLink(m.id)}>
                          {m.chat ? "Volver a vincular" : "Vincular"}
                        </ActionButton>
                      )}
                      {m.chat && (
                        <>
                          <ActionButton
                            icon="bolt"
                            disabled={busy === m.id}
                            onClick={() => run(m.id, () => sendTelegramTest(m.id), "Mensaje de prueba enviado.")}
                          >
                            Probar
                          </ActionButton>
                          <ActionButton icon="close" danger onClick={() => setUnlinking(m)}>
                            Desvincular
                          </ActionButton>
                        </>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {unlinking && (
        <ConfirmDialog
          title="Desvincular Telegram"
          confirmLabel="Desvincular"
          pendingLabel="Desvinculando…"
          icon="close"
          onConfirm={async () => {
            const r = await unlinkTelegram(unlinking.id);
            return r.ok ? { ok: true, error: null } : { ok: false, error: r.error };
          }}
          onClose={() => setUnlinking(null)}
        >
          <b>{unlinking.name}</b> deja de recibir alertas hasta que vuelva a vincular su Telegram.
        </ConfirmDialog>
      )}
    </>
  );
}

type TypeInfo = { key: string; label: string; detail: string };

// Por tipo de alerta, a quién le llega (solo personas con Telegram vinculado).
export function AlertRecipients({
  types,
  members,
  chosen,
  canEdit,
}: {
  types: TypeInfo[];
  members: Member[];
  chosen: Record<string, string[] | undefined>;
  canEdit: boolean;
}) {
  // Un tipo sin elección va a los admins vinculados: se muestra así marcado.
  const initial = Object.fromEntries(
    types.map((t) => [t.key, chosen[t.key] ?? members.filter((m) => m.role === "admin").map((m) => m.id)]),
  );
  const [value, setValue] = useState<Record<string, string[]>>(initial);
  const [state, setState] = useState<AlertsResult | null>(null);
  const [pending, startTransition] = useTransition();

  if (!members.length) {
    return <p className="modal-lead">Cuando alguien vincule su Telegram, acá vas a poder elegir qué alertas le llegan.</p>;
  }

  const toggle = (type: string, id: string) =>
    setValue((v) => ({ ...v, [type]: v[type].includes(id) ? v[type].filter((x) => x !== id) : [...v[type], id] }));

  return (
    <div>
      <div className="alerts-types">
        {types.map((t) => (
          <fieldset key={t.key} className="alerts-type" disabled={!canEdit || pending}>
            <legend>{t.label}</legend>
            <p>{t.detail}</p>
            <div className="stage-picker">
              {members.map((m) => (
                <label key={m.id} className={`stage-opt${value[t.key].includes(m.id) ? " on" : ""}`}>
                  <input type="checkbox" checked={value[t.key].includes(m.id)} onChange={() => toggle(t.key, m.id)} />
                  {m.name}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      {canEdit && (
        <div className="form-actions mt-4">
          <button
            type="button"
            className="connect-btn"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setState(null);
                setState(await saveAlertRecipients(value));
              })
            }
          >
            {pending ? "Guardando…" : "Guardar"}
          </button>
          {state && !state.ok && <span className="form-error">{state.error}</span>}
          {state?.ok && !pending && <span className="form-ok">Guardado.</span>}
        </div>
      )}
    </div>
  );
}
