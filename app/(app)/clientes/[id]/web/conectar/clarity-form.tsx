"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { connectClarity, disconnectClarity } from "../actions";

export function ClarityForm({ clientId, connected }: { clientId: string; connected: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  const router = useRouter();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setError(null);
    setOk(false);
    startTransition(async () => {
      const result = await connectClarity(null, data);
      if (!result.ok) return setError(result.error);
      form.current?.reset();
      setOk(true);
      router.refresh();
    });
  }

  function disconnect() {
    setError(null);
    startTransition(async () => {
      const result = await disconnectClarity(clientId);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  return (
    <>
      <form ref={form} onSubmit={submit} className="stack-form">
        <input type="hidden" name="clientId" value={clientId} />

        <label>
          <span>Token de exportación</span>
          <input
            name="token"
            type="password"
            required
            autoComplete="off"
            placeholder="Pegá el token generado en Clarity"
            disabled={pending}
          />
        </label>

        <label>
          <span>ID del proyecto (opcional)</span>
          <input name="projectId" autoComplete="off" placeholder="abc123def4" disabled={pending} />
        </label>

        {error && <p className="form-error">{error}</p>}
        {ok && !error && <p className="form-ok">Conectado. Ya trajimos la primera foto de las últimas 24 horas.</p>}

        <div className="form-actions">
          <button type="submit" className="connect-btn" disabled={pending}>
            {pending ? "Probando el token…" : connected ? "Reemplazar token" : "Conectar Clarity"}
          </button>
          {connected && (
            <button type="button" className="forum-del" onClick={disconnect} disabled={pending}>
              Desconectar
            </button>
          )}
        </div>
      </form>
    </>
  );
}
