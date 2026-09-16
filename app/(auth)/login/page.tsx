import type { Metadata } from "next";
import Image from "next/image";
import { GoogleButton } from "./google-button";

export const metadata: Metadata = {
  title: "Ingresar · Qualita Intranet",
};

const ERRORS: Record<string, string> = {
  dominio: "Solo se permiten cuentas @qualita.studio. Ingresá con tu cuenta corporativa.",
  auth: "No se pudo completar el ingreso. Probá de nuevo.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const message = error ? (ERRORS[error] ?? ERRORS.auth) : null;

  return (
    <main className="login">
      <div className="login-card">
        <Image
          className="login-logo"
          src="/qualita-logo-navy.svg"
          alt="Qualita"
          width={107}
          height={44}
          unoptimized
          priority
        />
        <h1>Intranet del equipo</h1>
        <p className="sub">
          Ingresá con tu cuenta corporativa <b>@qualita.studio</b>
        </p>
        {message && <p className="login-err login-err-box">{message}</p>}
        <GoogleButton />
        <p className="login-note">Solo se permiten cuentas @qualita.studio.</p>
      </div>
    </main>
  );
}
