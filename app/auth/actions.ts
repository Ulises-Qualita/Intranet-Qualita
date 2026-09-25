"use server";

import { redirect } from "next/navigation";
import { isQualitaEmail } from "@/lib/auth-shared";
import { createClient } from "@/lib/supabase/server";

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export type PasswordLoginState = { error: string | null };

// Ingreso de las cuentas de clientes (mail + contraseña). El equipo entra con
// Google: una cuenta @qualita.studio acá se rechaza aunque tenga contraseña. Solo
// pasa una cuenta que tenga empresa asignada y esté activa; si no, se cierra la
// sesión recién abierta para no dejar a nadie logueado sin acceso.
export async function signInWithPassword(_prev: PasswordLoginState, form: FormData): Promise<PasswordLoginState> {
  const email = String(form.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Completá el mail y la contraseña." };
  if (isQualitaEmail(email)) return { error: "El equipo de Qualita ingresa con Google." };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) return { error: "Mail o contraseña incorrectos." };

  const { data: account } = await supabase
    .from("intranet_client_users")
    .select("active")
    .eq("user_id", data.user.id)
    .maybeSingle<{ active: boolean }>();
  if (!account?.active) {
    await supabase.auth.signOut();
    return { error: account ? "Esta cuenta está desactivada. Escribile a tu contacto en Qualita." : "Esta cuenta no tiene acceso a la intranet." };
  }

  redirect("/mi-empresa");
}
