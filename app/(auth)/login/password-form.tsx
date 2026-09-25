"use client";

import { useActionState } from "react";
import { type PasswordLoginState, signInWithPassword } from "@/app/auth/actions";

// Ingreso de clientes con mail y contraseña (el equipo usa Google, arriba).
export function PasswordForm() {
  const [state, action, pending] = useActionState<PasswordLoginState, FormData>(signInWithPassword, { error: null });

  return (
    <form className="login-form" action={action}>
      <label>
        Mail
        <input type="email" name="email" autoComplete="email" required disabled={pending} />
      </label>
      <label>
        Contraseña
        <input type="password" name="password" autoComplete="current-password" required disabled={pending} />
      </label>
      {state.error && <p className="login-err">{state.error}</p>}
      <button type="submit" className="login-submit" disabled={pending}>
        {pending ? "Ingresando…" : "Ingresar"}
      </button>
    </form>
  );
}
