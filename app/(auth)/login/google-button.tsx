"use client";

import { useState } from "react";
import { GoogleIcon } from "@/components/icons";
import { ALLOWED_DOMAIN } from "@/lib/auth-shared";
import { createClient } from "@/lib/supabase/client";

export function GoogleButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setLoading(true);
    setError(null);
    const { error } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        // hd solo sugiere la cuenta en Google; el dominio se valida en /auth/callback y proxy.ts.
        queryParams: { hd: ALLOWED_DOMAIN, prompt: "select_account" },
      },
    });
    if (error) {
      setError("No se pudo iniciar el ingreso con Google. Probá de nuevo.");
      setLoading(false);
    }
  }

  return (
    <>
      <button type="button" className="google-btn" onClick={signIn} disabled={loading}>
        <GoogleIcon />
        {loading ? "Redirigiendo…" : "Continuar con Google"}
      </button>
      {error && <p className="login-err">{error}</p>}
    </>
  );
}
