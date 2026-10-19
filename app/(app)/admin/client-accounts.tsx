"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ClientAvatar } from "@/components/client-avatar";
import { Icon } from "@/components/icons";
import { Card, EmptyState } from "@/components/ui";
import type { Client, ClientAccount } from "@/lib/data";
import { relativeTime } from "@/lib/format";
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
              Esta persona deja de poder entrar y su cuenta se borra para siempre (las demás cuentas de la empresa siguen igual). Si solo querés cortarle el acceso por un
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
                ? "Esta persona entra con su mail y contraseña y ve solo lo de su empresa. Cada persona puede tener su propia cuenta."
                : "La contraseña anterior deja de funcionar al guardar."}
            </p>
            {mode === "create" && (
              <label className="acc-field">
                <span>Mail de la persona</span>
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

type Filter = "all" | "with" | "none";

const usersLabel = (n: number) => (n === 1 ? "1 usuario" : `${n} usuarios`);

// Los usuarios de un cliente, en un modal: cada uno con su mail, último ingreso,
// acceso y acciones, más "Agregar usuario". Las acciones abren el modal de cuenta
// encima de este, y al cerrarlo se vuelve acá. La lista sale de las props, así se
// actualiza sola cuando una acción revalida la página.
function UsersDialog({
  client,
  accounts,
  onAction,
  onClose,
}: {
  client: Client;
  accounts: ClientAccount[];
  onAction: (next: DialogState) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => ref.current?.showModal(), []);
  const close = () => ref.current?.close();

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="acc-users-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal-card modal-form acc-dialog acc-users">
        <div className="modal-head">
          <h2 id="acc-users-title">Usuarios</h2>
          <button type="button" className="modal-close" onClick={close} aria-label="Cerrar">
            ×
          </button>
        </div>

        <div className="acc-who">
          <ClientAvatar client={client} />
          <div>
            <b>{client.name}</b>
            <span>
              {accounts.length ? `${usersLabel(accounts.length)} · cada uno entra con su mail` : "Todavía no tiene usuarios"}
            </span>
          </div>
        </div>

        {accounts.length > 0 && (
          <ul className="acc-users-list">
            {accounts.map((a) => (
              <li key={a.userId}>
                <div className="acc-mail">
                  <span>{a.email}</span>
                  <small>
                    {a.lastSignInAt ? (
                      <span suppressHydrationWarning>Último ingreso {relativeTime(a.lastSignInAt)}</span>
                    ) : (
                      <span className="pill acc-never">Nunca ingresó</span>
                    )}
                  </small>
                </div>
                <ActiveToggle account={a} />
                <div className="account-buttons acc-row-actions">
                  <button
                    type="button"
                    className="icon-btn icon-btn-sm"
                    aria-label={`Ver el acceso de ${a.email}`}
                    title="Ver acceso"
                    onClick={() => onAction({ kind: "view", client, account: a })}
                  >
                    <Icon name="eye" size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn icon-btn-sm"
                    aria-label={`Cambiar la contraseña de ${a.email}`}
                    title="Cambiar contraseña"
                    onClick={() => onAction({ kind: "password", client, account: a })}
                  >
                    <Icon name="key" size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn icon-btn-sm icon-btn-danger"
                    aria-label={`Borrar la cuenta ${a.email}`}
                    title="Borrar cuenta"
                    onClick={() => onAction({ kind: "delete", client, account: a })}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={close}>
            Cerrar
          </button>
          <button type="button" className="connect-btn" onClick={() => onAction({ kind: "create", client })}>
            <Icon name="plus" size={15} strokeWidth={2} />
            Agregar usuario
          </button>
        </div>
      </div>
    </dialog>
  );
}

// Cuentas de clientes: varias por empresa, una por persona. Cada una entra en
// /login con su mail y contraseña y ve solo lo de su empresa en /mi-empresa. La
// tabla tiene una fila por cliente; los usuarios se ven en un modal.
export function ClientAccounts({ clients, accounts }: { clients: Client[]; accounts: ClientAccount[] | null }) {
  const [dialog, setDialog] = useState<(DialogState & { n: number }) | null>(null);
  const openDialog = (next: DialogState) => setDialog((prev) => ({ ...next, n: (prev?.n ?? 0) + 1 }));
  // Cliente con el modal de usuarios abierto (por id: la lista sale de las props).
  const [usersOf, setUsersOf] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  // Un grupo por cliente, con sus cuentas de la más vieja a la más nueva.
  const groups = useMemo(
    () =>
      clients.map((c) => ({
        client: c,
        accounts: (accounts ?? []).filter((a) => a.clientId === c.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      })),
    [clients, accounts],
  );

  const counts = {
    all: groups.length,
    with: groups.filter((g) => g.accounts.length).length,
    none: groups.filter((g) => !g.accounts.length).length,
  };
  const neverIn = groups.reduce((n, g) => n + g.accounts.filter((a) => !a.lastSignInAt).length, 0);

  // Se busca por cliente o por el mail de cualquiera de sus usuarios.
  const q = query.trim().toLowerCase();
  const visible = groups.filter(({ client, accounts: list }) => {
    if (filter === "with" && !list.length) return false;
    if (filter === "none" && list.length) return false;
    return !q || client.name.toLowerCase().includes(q) || list.some((a) => a.email.includes(q));
  });
  const open = usersOf ? groups.find((g) => g.client.id === usersOf) : null;

  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: "Todos" },
    { key: "with", label: "Con usuarios" },
    { key: "none", label: "Sin usuarios" },
  ];

  return (
    <Card title="Cuentas de clientes" hint="Cada persona entra con su mail y contraseña y ve solo lo de su empresa.">
      {accounts === null ? (
        <EmptyState label="Pendiente">Falta correr docs/sql/2026-09-25-cuentas-clientes.sql en Supabase.</EmptyState>
      ) : clients.length === 0 ? (
        <EmptyState label="Sin clientes">Todavía no hay clientes activos.</EmptyState>
      ) : (
        <>
          <div className="acc-toolbar">
            <div className="rec-filters acc-filters" role="tablist" aria-label="Filtrar clientes">
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
              {neverIn === 1 ? "1 usuario todavía no ingresó nunca" : `${neverIn} usuarios todavía no ingresaron nunca`}: puede
              que no les hayan llegado los datos.
            </p>
          )}

          <div className="table-wrap">
            <table className="ctable accounts-table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Usuarios</th>
                  <th>Último ingreso</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map(({ client: c, accounts: list }) => {
                  const inactive = list.filter((a) => !a.active).length;
                  const never = list.filter((a) => !a.lastSignInAt).length;
                  // El ingreso más reciente de cualquiera de sus usuarios.
                  const last = list.reduce<string | null>(
                    (max, a) => (a.lastSignInAt && (!max || a.lastSignInAt > max) ? a.lastSignInAt : max),
                    null,
                  );
                  return (
                    <tr key={c.id} className={list.length ? undefined : "acc-empty"}>
                      <td>
                        <div className="cl-cell">
                          <ClientAvatar client={c} />
                          <b>{c.name}</b>
                        </div>
                      </td>
                      <td>
                        {list.length ? (
                          <div className="acc-mail">
                            <span>{usersLabel(list.length)}</span>
                            {(inactive > 0 || never > 0) && (
                              <small>
                                {[
                                  inactive && `${inactive} ${inactive === 1 ? "desactivado" : "desactivados"}`,
                                  never && `${never} sin ingresar`,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </small>
                            )}
                          </div>
                        ) : (
                          <span className="muted">Sin usuarios todavía</span>
                        )}
                      </td>
                      <td>
                        {list.length > 0 &&
                          (last ? (
                            <span suppressHydrationWarning>{relativeTime(last)}</span>
                          ) : (
                            <span className="pill acc-never">Nunca ingresó</span>
                          ))}
                      </td>
                      <td>
                        <div className="account-buttons acc-row-actions">
                          {list.length ? (
                            <button type="button" className="btn-secondary btn-sm" onClick={() => setUsersOf(c.id)}>
                              <Icon name="users" size={15} />
                              Ver usuarios
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn-secondary btn-sm btn-primary"
                              onClick={() => openDialog({ kind: "create", client: c })}
                            >
                              <Icon name="plus" size={15} strokeWidth={2} />
                              Crear acceso
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={4} className="acc-none">
                      Ningún cliente coincide con la búsqueda.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {open && (
        <UsersDialog client={open.client} accounts={open.accounts} onAction={openDialog} onClose={() => setUsersOf(null)} />
      )}
      {dialog && <AccountDialog key={dialog.n} state={dialog} onClose={() => setDialog(null)} />}
    </Card>
  );
}
