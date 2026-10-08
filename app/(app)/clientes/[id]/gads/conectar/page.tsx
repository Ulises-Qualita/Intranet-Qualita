import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/icons";
import { Card, EmptyState, NoAccess } from "@/components/ui";
import { getAreaSession } from "@/lib/auth";
import { getClient } from "@/lib/data";
import {
  ACCOUNT_STATUS,
  type AdsAccount,
  formatCustomerId,
  googleAdsConfigured,
  googleAdsErrorMessage,
  listAdsAccounts,
  normalizeCustomerId,
} from "@/lib/google-ads";
import { ChooseAccountButton, DisconnectAdsButton } from "./account-actions";

// Elegir la cuenta de Google Ads del cliente entre las que cuelgan de la MCC del
// estudio. Se marca con ?cuenta=<id> y se vincula la marcada; ?buscar filtra por
// nombre o número de cuenta.
export default async function ConectarGadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ cuenta?: string; buscar?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const session = await getAreaSession("clientes");
  if (!session) return <NoAccess />;

  const client = await getClient(id);
  if (!client) notFound();

  const base = `/clientes/${client.slug}/gads/conectar`;
  const state = client.integrations.google_ads;
  const term = (query.buscar ?? "").trim().slice(0, 100);
  const picked = normalizeCustomerId(query.cuenta);

  if (!googleAdsConfigured()) {
    return (
      <section className="view view-column">
        <Card title="Cuenta de Google Ads">
          <EmptyState label="No configurado">
            Falta la cuenta de Google del estudio: GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_KEY,
            GOOGLE_ADS_USER y GOOGLE_ADS_LOGIN_CUSTOMER_ID en las variables de entorno.
          </EmptyState>
        </Card>
      </section>
    );
  }

  let accounts: AdsAccount[] = [];
  let loadError: string | null = null;
  try {
    accounts = await listAdsAccounts();
  } catch (e) {
    console.error("[google-ads] conectar", e);
    loadError = googleAdsErrorMessage(e);
  }

  const current = accounts.find((a) => a.id === state.accountRef);
  const needle = term.toLocaleLowerCase("es").replace(/-/g, "");
  const shown = needle
    ? accounts.filter((a) => a.name.toLocaleLowerCase("es").includes(needle) || a.id.includes(needle))
    : accounts;
  const chosen = picked ? accounts.find((a) => a.id === picked) : undefined;
  const linkTo = (account: string) => `${base}?${new URLSearchParams({ ...(term ? { buscar: term } : {}), cuenta: account })}`;

  return (
    <section className="view view-column">
      <p className="back-link">
        <Link href={`/clientes/${client.slug}/gads`}>← Volver a Google Ads</Link>
      </p>

      <Card
        title={`Cuenta de Google Ads · ${client.name}`}
        action={state.connected ? <DisconnectAdsButton clientId={client.id} /> : undefined}
        className="drive-connect"
      >
        {state.connected && state.accountRef && (
          <p className="drive-current">
            <Icon name="target" size={16} />
            Vinculada: <b>{current ? `${current.name} · ${formatCustomerId(current.id)}` : formatCustomerId(state.accountRef)}</b>
          </p>
        )}
        <p className="modal-lead">
          Elegí la cuenta de anuncios de <b>{client.name}</b>. Solo aparecen las cuentas que cuelgan de la MCC del estudio (
          {formatCustomerId(normalizeCustomerId(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID)!)}): si falta, primero hay que
          vincularla a la MCC desde Google Ads.
        </p>

        {loadError ? (
          <p className="form-error">{loadError}</p>
        ) : (
          <>
            <form className="drive-search" action={base}>
              <Icon name="search" size={16} />
              <input
                name="buscar"
                defaultValue={term}
                placeholder="Buscar por nombre o número de cuenta"
                autoComplete="off"
                aria-label="Buscar por nombre o número de cuenta"
              />
              <button type="submit" className="btn-secondary">
                Buscar
              </button>
            </form>

            {shown.length === 0 ? (
              <EmptyState label="Sin cuentas">
                {term ? "Ninguna cuenta coincide con la búsqueda." : "La MCC no tiene cuentas de anuncios vinculadas."}
              </EmptyState>
            ) : (
              <ul className="drive-folders gads-accounts">
                {shown.map((a) => (
                  <li key={a.id}>
                    <Link href={linkTo(a.id)} aria-current={a.id === picked ? "true" : undefined} scroll={false}>
                      <Icon name="target" size={17} />
                      <span>{a.name}</span>
                      <small>
                        {formatCustomerId(a.id)}
                        {a.currency && ` · ${a.currency}`}
                        {a.test && " · Prueba"}
                        {a.status && a.status !== "ENABLED" && ` · ${ACCOUNT_STATUS[a.status] ?? a.status}`}
                      </small>
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            {chosen && (
              <div className="form-actions">
                <ChooseAccountButton
                  clientId={client.id}
                  clientSlug={client.slug}
                  customerId={chosen.id}
                  accountName={chosen.name}
                  current={state.connected && state.accountRef === chosen.id}
                />
              </div>
            )}
          </>
        )}
      </Card>
    </section>
  );
}
