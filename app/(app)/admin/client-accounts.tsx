"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ClientAvatar } from "@/components/client-avatar";
import { Icon } from "@/components/icons";
import { Card, EmptyState } from "@/components/ui";
import type { Client, ClientAccount } from "@/lib/data";
import { relativeTime, shortDate } from "@/lib/format";
import {
  type ActionResult,
  createClientAccount,
  deleteClientAccount,
  revealClientAccountPassword,
  setClientAccountActive,
  setClientAccountPassword,
} from "./actions";

const MIN_PASSWORD = 8;

// Contraseña inicial para compartirle al cliente: 12 caracteres sin los que se
// confunden al dictarlos (0/O, 1/l/I).
function randomPassword() {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint32Array(12));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

const isEmail = (v: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim());

function CopyButton({ text, label = "Copiar", big }: { text: string; label?: string; big?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={big ? "connect-btn" : "copy-btn"}
      onClick={() =>
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        })
      }
    >
      <Icon name={copied ? "check" : "copy"} size={big ? 16 : 14} />
      {copied ? "Copiado" : label}
    </button>
  );
}

// Campo de contraseña visible (el admin la tiene que pasar) con "Generar otra".
function PasswordField({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const short = value.length > 0 && value.length < MIN_PASSWORD;
  return (
    <label className="acc-field">
      <span>Contraseña</span>
      <div className="pw-field">
        <input
          name="password"
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="new-password"
          spellCheck={false}
          disabled={disabled}
          required
          minLength={MIN_PASSWORD}
        />
        <button type="button" className="btn-secondary btn-sm" onClick={() => onChange(randomPassword())} disabled={disabled}>
          <Icon name="refresh" size={14} />
          Generar otra
        </button>
      </div>
      <small className={short ? "acc-warn" : undefined}>
        {short ? `Faltan ${MIN_PASSWORD - value.length} caracteres (mínimo ${MIN_PASSWORD}).` : "Ya viene una generada; podés escribir otra."}
      </small>
    </label>
  );
}

type Credentials = { name: string; email: string; password: string; isNew: boolean };

// Los datos de acceso listos para pasarle al cliente: cada uno con copiar y,
// además, el mensaje entero para mandar por WhatsApp o mail.
function CredentialsPanel({ creds }: { creds: Credentials }) {
  // Solo se dibuja después de una acción en el navegador: window ya existe.
  const loginUrl = `${window.location.origin}/login`;

  const message = [
    `¡Hola! Te compartimos ${creds.isNew ? "el acceso" : "la nueva contraseña"} al portal de ${creds.name} en Qualita Studio.`,
    "",
    `Ingresá en: ${loginUrl}`,
    `Mail: ${creds.email}`,
    `Contraseña: ${creds.password}`,
    "",
    "Ahí vas a ver el avance del proyecto, el calendario y las métricas.",
  ].join("\n");

  const rows = [
    { label: "Dónde ingresa", value: loginUrl },
    { label: "Mail", value: creds.email },
    { label: "Contraseña", value: creds.password, mono: true },
  ];

  return (
    <div className="acc-creds">
      <dl>
        {rows.map((r) => (
          <div key={r.label}>
            <dt>{r.label}</dt>
            <dd className={r.mono ? "mono" : undefined}>{r.value}</dd>
            <CopyButton text={r.value} />
          </div>
        ))}
      </dl>
      <CopyButton text={message} label="Copiar mensaje para el cliente" big />
    </div>
  );
}

type DialogState =
  | { kind: "create"; client: Client }
  | { kind: "view" | "password" | "delete"; client: Client; account: ClientAccount };

type Mode = DialogState["kind"];

// Un solo modal para crear, ver el acceso, cambiar la contraseña y borrar. Al
// crear o cambiar la contraseña pasa a mostrar los datos para compartir; si al
// ver no hay contraseña guardada, ofrece generar una ahí mismo. Se monta de nuevo
// en cada apertura, así arranca limpio.
function AccountDialog({ state, onClose }: { state: DialogState; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { client } = state;
  const account = state.kind === "create" ? null : state.account;
  const [mode, setMode] = useState<Mode>(state.kind);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(randomPassword);
  const [error, setError] = useState<string | null>(null);
  // Al ver: si no hay contraseña guardada, el aviso con "Generar una nueva".
  const [canReset, setCanReset] = useState(false);
  const [done, setDone] = useState<Credentials | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    ref.current?.showModal();
    if (state.kind !== "view") return;
    const { userId, email } = state.account;
    startTransition(async () => {
      const result = await revealClientAccountPassword(userId);
      if (result.ok) setDone({ name: client.name, email, password: result.password, isNew: true });
      else {
        setError(result.error);
        setCanReset(result.canReset);
      }
    });
    // Solo al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = () => {
    if (pending && mode !== "view") return;
    ref.current?.close();
  };

  const run = (fn: () => Promise<ActionResult>, onOk: () => void) =>
    startTransition(async () => {
      setError(null);
      const result = await fn();
      if (!result.ok) return setError(result.error);
      onOk();
    });

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (mode === "create" && !isEmail(email)) return setError("Revisá el mail: parece incompleto.");
    if (password.length < MIN_PASSWORD) return setError(`La contraseña tiene que tener al menos ${MIN_PASSWORD} caracteres.`);
    const pw = password;
    if (!account) {
      const mail = email.trim().toLowerCase();
      const form = new FormData();
      form.set("clientId", client.id);
      form.set("email", mail);
      form.set("password", pw);
      run(
        () => createClientAccount(null, form),
        () => setDone({ name: client.name, email: mail, password: pw, isNew: true }),
      );
    } else {
      run(
        () => setClientAccountPassword(account.userId, pw),
        () => setDone({ name: client.name, email: account.email, password: pw, isNew: false }),
      );
    }
  }

  const title = done
    ? mode === "view"
      ? "Datos de acceso"
      : mode === "create"
        ? "Cuenta creada"
        : "Contraseña cambiada"
    : { create: "Crear acceso", view: "Datos de acceso", password: "Cambiar contraseña", delete: "Borrar cuenta" }[mode];

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="acc-dialog-title"
      onClose={onClose}
      onCancel={(e) => {
        if (pending && mode !== "view") e.preventDefault();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal-card modal-form acc-dialog">
        <div className="modal-head">
          <h2 id="acc-dialog-title">{title}</h2>
          <button type="button" className="modal-close" onClick={close} aria-label="Cerrar">
            ×
          </button>
        </div>

        <div className="acc-who">
          <ClientAvatar client={client} />
          <div>
            <b>{client.name}</b>
            {account && <span>{account.email}</span>}
          </div>
        </div>

        {done ? (
          <>
            <CredentialsPanel creds={done} />
            <div className="modal-actions">
              {mode === "view" && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setDone(null);
                    setMode("password");
                  }}
                >
                  <Icon name="key" size={15} />
                  Cambiar contraseña
                </button>
              )}
              <button type="button" className="btn-secondary" onClick={close}>
                Listo
              </button>
            </div>
          </>
        ) : mode === "view" ? (
          pending ? (
            <p className="acc-loading">Buscando la contraseña…</p>
          ) : (
            <>
              {error && <p className="acc-alert">{error}</p>}
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={close}>
                  Cerrar
                </button>
                {canReset && (
                  <button
                    type="button"
                    className="connect-btn"
                    onClick={() => {
                      setError(null);
                      setMode("password");
                    }}
                  >
                    Generar una nueva
                  </button>
                )}
              </div>
            </>
          )
        ) : mode === "delete" && account ? (
          <>
            <p className="modal-lead">
              El cliente deja de poder entrar y la cuenta se borra para siempre. Si solo querés cortarle el acceso por un
              tiempo, <b>desactivala</b>: se puede volver a activar con la misma contraseña.
            </p>
            {error && <p className="form-error modal-error">{error}</p>}
            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary"
                disabled={pending || !account.active}
                onClick={() => run(() => setClientAccountActive(account.userId, false), () => ref.current?.close())}
              >
                {account.active ? "Solo desactivar" : "Ya está desactivada"}
              </button>
              <button
                type="button"
                className="btn-secondary btn-danger"
                disabled={pending}
                onClick={() => run(() => deleteClientAccount(account.userId), () => ref.current?.close())}
              >
                {pending ? "Borrando…" : "Borrar cuenta"}
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={submit} noValidate>
            <p className="modal-lead">
              {mode === "create"
                ? "El cliente entra con este mail y contraseña y ve solo lo suyo."
                : "La contraseña anterior deja de funcionar al guardar."}
            </p>
            {mode === "create" && (
              <label className="acc-field">
                <span>Mail del cliente</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nombre@empresa.com"
                  autoComplete="off"
                  autoFocus
                  disabled={pending}
                  required
                />
              </label>
            )}
            <PasswordField value={password} onChange={setPassword} disabled={pending} />
            {error && <p className="form-error modal-error">{error}</p>}
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={close} disabled={pending}>
                Cancelar
              </button>
              <button type="submit" className="connect-btn" disabled={pending}>
                {pending
                  ? mode === "create"
                    ? "Creando…"
                    : "Guardando…"
                  : mode === "create"
                    ? "Crear cuenta"
                    : "Guardar contraseña"}
              </button>
            </div>
          </form>
        )}
      </div>
    </dialog>
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
        title={account.active ? "Cortar el acceso (se puede volver a activar)" : "Devolverle el acceso"}
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

type Filter = "all" | "none" | "active" | "inactive";

// Cuentas de clientes: una por empresa. El cliente entra en /login con mail y
// contraseña y ve solo lo suyo en /mi-empresa.
export function ClientAccounts({ clients, accounts }: { clients: Client[]; accounts: ClientAccount[] | null }) {
  const [dialog, setDialog] = useState<(DialogState & { n: number }) | null>(null);
  const openDialog = (next: DialogState) => setDialog((prev) => ({ ...next, n: (prev?.n ?? 0) + 1 }));
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const rows = useMemo(
    () => clients.map((c) => ({ client: c, account: accounts?.find((a) => a.clientId === c.id) ?? null })),
    [clients, accounts],
  );

  const counts = {
    all: rows.length,
    none: rows.filter((r) => !r.account).length,
    active: rows.filter((r) => r.account?.active).length,
    inactive: rows.filter((r) => r.account && !r.account.active).length,
  };
  const neverIn = rows.filter((r) => r.account && !r.account.lastSignInAt).length;

  const q = query.trim().toLowerCase();
  const visible = rows.filter(({ client, account }) => {
    if (filter === "none" && account) return false;
    if (filter === "active" && !account?.active) return false;
    if (filter === "inactive" && (!account || account.active)) return false;
    return !q || client.name.toLowerCase().includes(q) || (account?.email.includes(q) ?? false);
  });

  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: "Todos" },
    { key: "none", label: "Sin cuenta" },
    { key: "active", label: "Activas" },
    { key: "inactive", label: "Desactivadas" },
  ];

  return (
    <Card title="Cuentas de clientes" hint="Una por empresa. Ingresan con mail y contraseña y ven solo lo suyo.">
      {accounts === null ? (
        <EmptyState label="Pendiente">Falta correr docs/sql/2026-09-25-cuentas-clientes.sql en Supabase.</EmptyState>
      ) : clients.length === 0 ? (
        <EmptyState label="Sin clientes">Todavía no hay clientes activos.</EmptyState>
      ) : (
        <>
          <div className="acc-toolbar">
            <div className="rec-filters acc-filters" role="tablist" aria-label="Filtrar cuentas">
              {filters.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  role="tab"
                  aria-selected={filter === f.key}
                  className={`chip${filter === f.key ? " on" : ""}`}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                  <span>{counts[f.key]}</span>
                </button>
              ))}
            </div>
            <label className="dv-search">
              <Icon name="search" size={15} />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar cliente o mail"
                aria-label="Buscar cliente o mail"
              />
            </label>
          </div>

          {neverIn > 0 && (
            <p className="acc-hint">
              {neverIn === 1 ? "1 cuenta todavía no ingresó nunca" : `${neverIn} cuentas todavía no ingresaron nunca`}: puede
              que no les hayan llegado los datos.
            </p>
          )}

          <div className="table-wrap">
            <table className="ctable accounts-table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Cuenta</th>
                  <th>Último ingreso</th>
                  <th>Acceso</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map(({ client: c, account }) => (
                  <tr key={c.id} className={account ? undefined : "acc-empty"}>
                    <td>
                      <div className="cl-cell">
                        <ClientAvatar client={c} />
                        <b>{c.name}</b>
                      </div>
                    </td>
                    <td>
                      {account ? (
                        <div className="acc-mail">
                          <span>{account.email}</span>
                          <small>Creada el {shortDate(account.createdAt.slice(0, 10))}</small>
                        </div>
                      ) : (
                        <span className="muted">Sin cuenta todavía</span>
                      )}
                    </td>
                    <td>
                      {account &&
                        (account.lastSignInAt ? (
                          <span suppressHydrationWarning>{relativeTime(account.lastSignInAt)}</span>
                        ) : (
                          <span className="pill acc-never">Nunca ingresó</span>
                        ))}
                    </td>
                    <td>{account && <ActiveToggle account={account} />}</td>
                    <td>
                      <div className="account-buttons acc-row-actions">
                        {account ? (
                          <>
                            <button
                              type="button"
                              className="btn-secondary btn-sm"
                              onClick={() => openDialog({ kind: "view", client: c, account })}
                            >
                              <Icon name="eye" size={15} />
                              Ver acceso
                            </button>
                            <button
                              type="button"
                              className="btn-secondary btn-sm"
                              onClick={() => openDialog({ kind: "password", client: c, account })}
                            >
                              <Icon name="key" size={15} />
                              Cambiar contraseña
                            </button>
                            <button
                              type="button"
                              className="icon-btn icon-btn-sm icon-btn-danger"
                              aria-label={`Borrar la cuenta de ${c.name}`}
                              title="Borrar cuenta"
                              onClick={() => openDialog({ kind: "delete", client: c, account })}
                            >
                              <Icon name="trash" size={16} />
                            </button>
                          </>
                        ) : (
                          <button type="button" className="btn-secondary btn-sm btn-primary" onClick={() => openDialog({ kind: "create", client: c })}>
                            <Icon name="plus" size={15} strokeWidth={2} />
                            Crear acceso
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={5} className="acc-none">
                      Ningún cliente coincide con la búsqueda.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {dialog && <AccountDialog key={dialog.n} state={dialog} onClose={() => setDialog(null)} />}
    </Card>
  );
}
