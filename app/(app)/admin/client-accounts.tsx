"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { ClientAvatar } from "@/components/client-avatar";
import { Icon } from "@/components/icons";
import { Card, EmptyState } from "@/components/ui";
import type { Client, ClientAccount } from "@/lib/data";
import {
  type ActionResult,
  createClientAccount,
  deleteClientAccount,
  setClientAccountActive,
  setClientAccountPassword,
} from "./actions";

// Contraseña inicial para compartirle al cliente: 12 caracteres sin los que se
// confunden al dictarlos (0/O, 1/l/I).
function randomPassword() {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint32Array(12));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

// Campo de contraseña visible (el admin la tiene que pasar) con "Generar".
function PasswordInput({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div className="pw-field">
      <input
        name="password"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Contraseña (mín. 8)"
        autoComplete="new-password"
        spellCheck={false}
        disabled={disabled}
        required
        minLength={8}
      />
      <button type="button" className="link-connect" onClick={() => onChange(randomPassword())} disabled={disabled}>
        Generar
      </button>
    </div>
  );
}

function CreateForm({ client, onDone }: { client: Client; onDone: (email: string, password: string) => void }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createClientAccount, null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(randomPassword);

  useEffect(() => {
    if (state?.ok) onDone(email, password);
    // Solo al llegar la respuesta: email y password son los que se mandaron.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={action} className="account-form">
      <input type="hidden" name="clientId" value={client.id} />
      <input
        name="email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Mail del cliente"
        autoComplete="off"
        required
        disabled={pending}
      />
      <PasswordInput value={password} onChange={setPassword} disabled={pending} />
      <button type="submit" className="connect-btn" disabled={pending}>
        {pending ? "Creando…" : "Crear cuenta"}
      </button>
      {state?.error && <p className="form-error form-msg">{state.error}</p>}
    </form>
  );
}

// Estado de la cuenta como interruptor: se lee y se cambia en el mismo lugar, y
// es reversible, así que no pide confirmación.
function ActiveToggle({ account }: { account: ClientAccount }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="account-status">
      <button
        type="button"
        role="switch"
        aria-checked={account.active}
        aria-label={account.active ? "Desactivar cuenta" : "Activar cuenta"}
        title={account.active ? "Desactivar cuenta" : "Activar cuenta"}
        className={`toggle${account.active ? " on" : ""}`}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await setClientAccountActive(account.userId, !account.active);
            if (!result.ok) setError(result.error);
          })
        }
      />
      <span className={account.active ? "on" : undefined}>{account.active ? "Activa" : "Desactivada"}</span>
      {error && <p className="form-error form-msg">{error}</p>}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="copy-btn"
      onClick={() =>
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        })
      }
    >
      <Icon name={copied ? "check" : "copy"} size={14} />
      {copied ? "Copiada" : "Copiar"}
    </button>
  );
}

function AccountActions({ account, name }: { account: ClientAccount; name: string }) {
  const [mode, setMode] = useState<"idle" | "password" | "delete">("idle");
  const [password, setPassword] = useState("");
  // La contraseña nueva queda a la vista (con copiar) hasta la próxima acción.
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<ActionResult>, onOk?: () => void) =>
    startTransition(async () => {
      setError(null);
      const result = await fn();
      if (!result.ok) return setError(result.error);
      setMode("idle");
      onOk?.();
    });

  const open = (next: "password" | "delete") => {
    setSaved(null);
    setError(null);
    if (next === "password") setPassword(randomPassword());
    setMode(next);
  };

  return (
    <div className="account-actions">
      {mode === "password" ? (
        <form
          className="account-form"
          onSubmit={(e) => {
            e.preventDefault();
            const value = password;
            run(() => setClientAccountPassword(account.userId, value), () => setSaved(value));
          }}
        >
          <PasswordInput value={password} onChange={setPassword} disabled={pending} />
          <button type="submit" className="btn-secondary btn-sm btn-primary" disabled={pending}>
            {pending ? "Guardando…" : "Guardar"}
          </button>
          <button type="button" className="btn-secondary btn-sm" onClick={() => setMode("idle")} disabled={pending}>
            Cancelar
          </button>
        </form>
      ) : mode === "delete" ? (
        <div className="account-confirm" role="alertdialog" aria-label={`Borrar la cuenta de ${name}`}>
          <span>
            ¿Borrar la cuenta de <b>{name}</b>? No se puede deshacer.
          </span>
          <div className="account-buttons">
            <button type="button" className="btn-secondary btn-sm" onClick={() => setMode("idle")} disabled={pending}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm btn-danger"
              disabled={pending}
              onClick={() => run(() => deleteClientAccount(account.userId))}
            >
              {pending ? "Borrando…" : "Sí, borrar"}
            </button>
          </div>
        </div>
      ) : (
        <div className="account-buttons">
          <button type="button" className="btn-secondary btn-sm" disabled={pending} onClick={() => open("password")}>
            <Icon name="key" size={15} />
            Contraseña
          </button>
          <button
            type="button"
            className="icon-btn icon-btn-sm icon-btn-danger"
            aria-label={`Borrar la cuenta de ${name}`}
            title="Borrar cuenta"
            disabled={pending}
            onClick={() => open("delete")}
          >
            <Icon name="trash" size={16} />
          </button>
        </div>
      )}
      {saved && (
        <p className="form-ok form-msg account-saved">
          Nueva contraseña: <code>{saved}</code>
          <CopyButton text={saved} />
        </p>
      )}
      {error && <p className="form-error form-msg">{error}</p>}
    </div>
  );
}

// Cuentas de clientes: una por empresa. El cliente entra en /login con mail y
// contraseña y ve solo lo suyo en /mi-empresa.
export function ClientAccounts({ clients, accounts }: { clients: Client[]; accounts: ClientAccount[] | null }) {
  const [creating, setCreating] = useState<string | null>(null);
  // Tras crear una cuenta, los datos para pasarle al cliente (no se vuelven a mostrar).
  const [created, setCreated] = useState<{ name: string; email: string; password: string } | null>(null);

  return (
    <Card title="Cuentas de clientes" hint="Una por empresa. Ingresan con mail y contraseña y ven solo lo suyo.">
      {accounts === null ? (
        <EmptyState label="Pendiente">Falta correr docs/sql/2026-09-25-cuentas-clientes.sql en Supabase.</EmptyState>
      ) : clients.length === 0 ? (
        <EmptyState label="Sin clientes">Todavía no hay clientes activos.</EmptyState>
      ) : (
        <div className="table-wrap">
          {created && (
            <p className="form-ok form-msg account-created">
              Cuenta de <b>{created.name}</b> creada. Pasale estos datos: ingresa en la intranet con{" "}
              <b>{created.email}</b> y la contraseña <b>{created.password}</b>. No se vuelve a mostrar.
            </p>
          )}
          <table className="ctable accounts-table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Cuenta</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => {
                const account = accounts.find((a) => a.clientId === c.id);
                return (
                  <tr key={c.id}>
                    <td>
                      <div className="cl-cell">
                        <ClientAvatar client={c} />
                        <b>{c.name}</b>
                      </div>
                    </td>
                    <td>{account ? account.email : <span className="muted">Sin cuenta</span>}</td>
                    <td>{account ? <ActiveToggle account={account} /> : null}</td>
                    <td>
                      {account ? (
                        <AccountActions account={account} name={c.name} />
                      ) : creating === c.id ? (
                        <CreateForm
                          client={c}
                          onDone={(email, password) => {
                            setCreating(null);
                            setCreated({ name: c.name, email, password });
                          }}
                        />
                      ) : (
                        <button type="button" className="link-connect" onClick={() => setCreating(c.id)}>
                          Crear cuenta
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
