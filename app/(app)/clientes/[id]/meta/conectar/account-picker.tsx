"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Portfolio } from "@/lib/meta";
import { connectMetaAccount } from "../../../actions";

export function AccountPicker({
  clientId,
  clientSlug,
  portfolios,
  currentAccountId,
}: {
  clientId: string;
  clientSlug: string;
  portfolios: Portfolio[];
  currentAccountId: string | null;
}) {
  const router = useRouter();
  const initialPortfolio =
    portfolios.find((p) => p.accounts.some((a) => a.id === currentAccountId)) ?? portfolios.find((p) => p.accounts.length);
  const [portfolioId, setPortfolioId] = useState(initialPortfolio?.id ?? "");
  const [accountId, setAccountId] = useState(currentAccountId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const portfolio = portfolios.find((p) => p.id === portfolioId);

  if (!portfolios.some((p) => p.accounts.length)) {
    return (
      <p className="form-error">
        Tu usuario de Facebook no tiene acceso a ninguna cuenta publicitaria. Pedí acceso al portfolio del cliente e iniciá sesión de nuevo.
      </p>
    );
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await connectMetaAccount(clientId, accountId);
      if (result.ok) router.push(`/clientes/${clientSlug}/meta`);
      else setError(result.error);
    });
  }

  return (
    <form
      className="stack-form"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label>
        <span>Portfolio empresarial</span>
        <select
          value={portfolioId}
          onChange={(e) => {
            setPortfolioId(e.target.value);
            setAccountId("");
          }}
          disabled={pending}
        >
          {portfolios.map((p) => (
            <option key={p.id} value={p.id} disabled={!p.accounts.length}>
              {p.name}
              {p.accounts.length ? "" : " (sin cuentas publicitarias)"}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="account-list" disabled={pending}>
        <legend>Cuenta publicitaria</legend>
        {portfolio?.accounts.map((a) => (
          <label key={a.id} className={`account-opt${accountId === a.id ? " on" : ""}`}>
            <input type="radio" name="account" value={a.id} checked={accountId === a.id} onChange={() => setAccountId(a.id)} />
            <span className="account-txt">
              <b>{a.name}</b>
              <span>
                {a.id.replace("act_", "ID ")}
                {a.currency && ` · ${a.currency}`}
              </span>
            </span>
            {!a.active && <span className="pill pausado">Inactiva</span>}
          </label>
        ))}
      </fieldset>

      {error && <p className="form-error">{error}</p>}

      <div className="form-actions">
        <button type="submit" className="connect-btn" disabled={pending || !accountId}>
          {pending ? "Conectando…" : "Conectar esta cuenta"}
        </button>
      </div>
    </form>
  );
}
