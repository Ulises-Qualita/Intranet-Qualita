import Link from "next/link";
import { notFound } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { Card, NoAccess } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { getClient } from "@/lib/data";
import { getMetaSecrets, isAuthError, listPortfolios, metaConfigured, type Portfolio } from "@/lib/meta";
import { AccountPicker } from "./account-picker";
import { DisconnectMetaButton } from "./disconnect-button";

const ERRORS: Record<string, string> = {
  cancelado: "Se canceló el inicio de sesión con Facebook.",
  login: "No se pudo completar el inicio de sesión con Facebook. Probá de nuevo.",
  config: "Falta configurar la app de Meta en el servidor (META_APP_ID y META_APP_SECRET).",
};

export default async function ConectarMetaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ id }, { error }] = await Promise.all([params, searchParams]);
  const session = await getAreaSession("clientes");
  if (!session) {
    return (
      <>
        <Topbar crumb="Clientes" title="Conectar Meta" />
        <NoAccess />
      </>
    );
  }

  const client = await getClient(id);
  if (!client) notFound();

  const loginHref = `/api/integraciones/meta/start?client=${encodeURIComponent(client.slug)}`;
  const secrets = metaConfigured() ? await getMetaSecrets(client.id) : null;

  let portfolios: Portfolio[] | null = null;
  let loadError: string | null = error ? (ERRORS[error] ?? null) : null;
  if (secrets) {
    try {
      portfolios = await listPortfolios(secrets.access_token);
    } catch (e) {
      console.error("[meta] listPortfolios", e);
      loadError = isAuthError(e)
        ? "La sesión de Facebook venció o fue revocada. Volvé a iniciar sesión."
        : "No se pudieron leer los portfolios de Meta. Probá de nuevo en unos minutos.";
    }
  }

  return (
    <>
      <Topbar crumb={client.name} title="Conectar Meta" />
      <section className="view">
        <p className="back-link">
          <Link href={`/clientes/${client.slug}/meta`}>← Volver a META</Link>
        </p>

        <Card
          title={`Cuenta de Meta · ${client.name}`}
          hint={client.integrations.meta.connected ? `Conectada: ${client.integrations.meta.accountRef}` : undefined}
          action={client.integrations.meta.connected ? <DisconnectMetaButton clientId={client.id} /> : undefined}
          className="meta-connect"
        >
          {loadError && <p className="form-error">{loadError}</p>}

          {portfolios && secrets ? (
            <>
              <p className="modal-lead">
                Sesión de Facebook: <b>{secrets.fb_user_name}</b> ·{" "}
                <a href={loginHref} className="link-connect">
                  Usar otra cuenta
                </a>
              </p>
              <AccountPicker
                clientId={client.id}
                clientSlug={client.slug}
                portfolios={portfolios}
                currentAccountId={client.integrations.meta.connected ? client.integrations.meta.accountRef : null}
              />
            </>
          ) : (
            <div className="connect-state">
              <p>
                Iniciá sesión con tu usuario de Facebook y elegí el portfolio empresarial y la cuenta publicitaria de{" "}
                <b>{client.name}</b>. Solo se van a ver las cuentas a las que tu usuario tiene acceso.
              </p>
              {/* <a> y no <Link>: el destino redirige a facebook.com. */}
              <a href={loginHref} className="connect-btn">
                Continuar con Facebook
              </a>
            </div>
          )}
        </Card>
      </section>
    </>
  );
}
