import type { Metadata } from "next";
import Image from "next/image";
import { GoogleButton } from "./google-button";
import { PasswordForm } from "./password-form";

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
          src="/Logo-nuevo.png"
          alt="Qualita"
          width={145}
          height={38}
          unoptimized
          priority
        />
        <h1>Intranet de Qualita</h1>
        <p className="sub">Ingresá para ver tus métricas y las de tus clientes.</p>
        {message && <p className="login-err login-err-box">{message}</p>}
        <GoogleButton />
        <p className="login-note">El equipo ingresa con su cuenta @qualita.studio.</p>

        <div className="login-sep">
          <span>¿Sos cliente de Qualita?</span>
        </div>
        <PasswordForm />
      </div>
    </main>
  );
}
