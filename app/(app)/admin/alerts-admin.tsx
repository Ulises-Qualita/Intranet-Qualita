"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
// (o se le manda a la persona) y se toca «Iniciar». Mientras el link está a la
// vista, la pantalla consulta sola cada pocos segundos si ya llegó.
const POLL_MS = 4000;
const POLL_FOR_MS = 5 * 60_000;
export function TelegramLinks({ members, canEdit }: { members: Member[]; canEdit: boolean }) {
  const [links, setLinks] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ id: string; ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [unlinking, setUnlinking] = useState<Member | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();
  // Cuándo se generó cada link: se deja de consultar a los 5 minutos.
  const [since, setSince] = useState<Record<string, number>>({});

  const dropLink = (id: string) =>
    setLinks((l) => {
      const next = { ...l };
      delete next[id];
      return next;
    });

  useEffect(() => {
    const waiting = Object.keys(links);
    if (!waiting.length) return;
    let stopped = false;
    const timer = setInterval(async () => {
      for (const id of waiting) {
        if (stopped) return;
        if (Date.now() - (since[id] ?? 0) > POLL_FOR_MS) {
          dropLink(id);
          setNotice({ id, ok: false, text: "No llegó el «Iniciar» de Telegram. Volvé a tocar «Vincular» para probar de nuevo." });
          continue;
        }
        const result = await verifyTelegramLink(id);
        if (stopped) return;
        if (result.ok) {
          dropLink(id);
          setNotice({ id, ok: true, text: "Vinculado. Te llegó un mensaje de confirmación en Telegram." });
          router.refresh();
        } else if (!("pending" in result)) {
          dropLink(id);
          setNotice({ id, ok: false, text: result.error });
        }
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [links, since, router]);

  const run = (id: string, action: () => Promise<AlertsResult>, okText: string) =>
    startTransition(async () => {
      setBusy(id);
      const result = await action();
      setBusy(null);
      setNotice({ id, ok: result.ok, text: result.ok ? okText : result.error });
    });

  const makeLink = (id: string) =>
    startTransition(async () => {
      setBusy(id);
      const result = await createTelegramLink(id);
      setBusy(null);
      if (!result.ok) return setNotice({ id, ok: false, text: result.error });
      setNotice(null);
      setSince((s) => ({ ...s, [id]: Date.now() }));
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
                      <span>Usá este link en tu Telegram para conectarte a la intranet:</span>
                      <a href={links[m.id]} target="_blank" rel="noopener noreferrer">
                        {links[m.id]}
                      </a>
                      <span className="alerts-waiting">Esperando que toques «Iniciar» en Telegram…</span>
                    </div>
                  )}
                  {notice?.id === m.id && <div className={notice.ok ? "form-ok" : "form-error"}>{notice.text}</div>}
                </td>
                <td>
                  {canEdit && (
                    <div className="alerts-actions">
                      {links[m.id] ? (
                        <ActionButton icon="close" onClick={() => dropLink(m.id)}>
                          Cancelar
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
