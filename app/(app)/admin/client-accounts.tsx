"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { ClientAvatar } from "@/components/client-avatar";
import { Card, EmptyState, Pill } from "@/components/ui";
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

function AccountActions({ account, name }: { account: ClientAccount; name: string }) {
  const [mode, setMode] = useState<"idle" | "password" | "delete">("idle");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<ActionResult>, okText: string) =>
    startTransition(async () => {
      setMsg(null);
      const result = await fn();
      setMsg(result.ok ? { ok: true, text: okText } : { ok: false, text: result.error });
      if (result.ok) setMode("idle");
    });

  return (
    <div className="account-actions">
      {mode === "password" ? (
        <form
          className="account-form"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => setClientAccountPassword(account.userId, password), `Contraseña cambiada: ${password}`);
          }}
        >
          <PasswordInput value={password} onChange={setPassword} disabled={pending} />
          <button type="submit" className="connect-btn" disabled={pending}>
            Guardar
          </button>
          <button type="button" className="link-connect" onClick={() => setMode("idle")} disabled={pending}>
            Cancelar
          </button>
        </form>
      ) : mode === "delete" ? (
        <div className="account-confirm">
          <span>¿Borrar la cuenta de {name}? No se puede deshacer.</span>
          <button
            type="button"
            className="link-danger"
            disabled={pending}
            onClick={() => run(() => deleteClientAccount(account.userId), "Cuenta borrada.")}
          >
            Sí, borrar
          </button>
          <button type="button" className="link-connect" onClick={() => setMode("idle")} disabled={pending}>
            Cancelar
          </button>
        </div>
      ) : (
        <div className="account-buttons">
          <button
            type="button"
            className="link-connect"
            disabled={pending}
            onClick={() => {
              setPassword(randomPassword());
              setMode("password");
            }}
          >
            Cambiar contraseña
          </button>
          <button
            type="button"
            className="link-connect"
            disabled={pending}
            onClick={() =>
              run(
                () => setClientAccountActive(account.userId, !account.active),
                account.active ? "Cuenta desactivada." : "Cuenta activada.",
              )
            }
          >
            {account.active ? "Desactivar" : "Activar"}
          </button>
          <button type="button" className="link-danger" disabled={pending} onClick={() => setMode("delete")}>
            Borrar
          </button>
        </div>
      )}
      {msg && <p className={`${msg.ok ? "form-ok" : "form-error"} form-msg`}>{msg.text}</p>}
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
    <Card title="Cuentas de clientes" hint="Una por empresa. Ingresan con mail y contraseña y ven solo lo suyo." className="mt-4">
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
                    <td>
                      {account ? (
                        account.active ? (
                          <Pill variant="activo">Activa</Pill>
                        ) : (
                          <Pill variant="pausado">Desactivada</Pill>
                        )
                      ) : null}
                    </td>
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
