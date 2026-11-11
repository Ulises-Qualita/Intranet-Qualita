import { RangePicker } from "@/components/range-picker";
import { Topbar } from "@/components/topbar";
import { Card, EmptyState, Kpi, KpiLocked, MissingIntegration } from "@/components/ui";
import { getCrmSecrets } from "@/lib/crm-sync";
import { goalFor } from "@/lib/billing-goals";
import {
  type Client,
  crmPeriod,
  getBillingGoals,
  getGadsDaily,
  getLeads,
  getMetaDaily,
  getSales,
  salesPeriod,
} from "@/lib/data";
import { dollars, integer, money, orDash, percent, ratio, safeDiv, shortDate, todayISO } from "@/lib/format";
import { monthName, type Period } from "@/lib/period";
import { getUsdRate } from "@/lib/usd-rate";
import { BillingGoalEditor } from "./billing-goal-editor";

// Un paso del recorrido de la inversión. `value` null = falta la integración o el dato.
type Step = { label: string; value: string | null; extra?: string | null; cost?: [figure: string, text: string] | null; missing?: string };

// Vista general de un cliente. La usan el equipo (/clientes/[slug]) y la cuenta
// del propio cliente (/mi-empresa): quien la llama ya validó el acceso.
// `internal` muestra lo que es solo del equipo (links para conectar
// integraciones); `base` es la ruta de las pestañas de este cliente.
export async function OverviewView({
  c,
  range,
  base,
  internal,
}: {
  c: Client;
  range: Period;
  base: string;
  internal: boolean;
}) {
  const [daily, gadsDaily, leads, secrets, billingGoals] = await Promise.all([
    c.conn.meta ? getMetaDaily(c.id, range) : [],
    c.conn.google_ads ? getGadsDaily(c.id, range) : [],
    c.conn.crm ? getLeads(c.id) : [],
    c.conn.crm ? getCrmSecrets(c.id) : null,
    // El objetivo de facturación lo ve también la cuenta del cliente (solo lectura:
    // "Editar objetivo" es del equipo).
    getBillingGoals(c.id),
  ]);
  // Con planilla de ventas, las ventas y la facturación salen de ahí (por fecha de confirmación).
  const allSales = secrets?.sales_sheet ? await getSales(c.id) : null;

  // La inversión y los leads son Meta + Google Ads (los montos, los dos en pesos).
  const metaSpend = daily.reduce((total, d) => total + d.spend, 0);
  const gadsSpend = gadsDaily.reduce((total, d) => total + d.cost, 0);
  const spend = metaSpend + gadsSpend;
  // Mismo cálculo que la card "Leads generados" de la solapa META.
  const metaLeads = daily.reduce((total, d) => total + d.leads, 0);

  // Conversión = ventas del período sobre oportunidades creadas en el período. Con
  // planilla, las ventas son las confirmadas en el período (como en el recorrido),
  // aunque el lead sea de un mes anterior: si no, una venta de octubre de un lead de
  // septiembre no contaba en ningún mes. Sin planilla ni estado en el CRM
  // (sales === null) no hay forma de saber qué se ganó, y la card lo dice en vez de
  // mostrar 0%.
  const crm = crmPeriod(leads, range);
  const won = crm.won;
  const opportunities = crm.leads.length;
  const periodo = range.label;

  // Recorrido de la inversión: de lo invertido en publicidad a lo facturado, con
  // lo que costó cada paso. Las oportunidades y las ventas son de todos los
  // orígenes, así que los costos son la inversión total dividida por cada paso, no
  // un costo atribuido; la nota de la card lo dice. Los leads de Google Ads son sus
  // conversiones (como en el reporte), que pueden tener decimales.
  const gadsLeads = gadsDaily.reduce((total, d) => total + d.conversions, 0);
  const adLeads = metaLeads + gadsLeads;
  const leadCount = (n: number) => (Number.isInteger(n) ? integer(n) : n.toLocaleString("es-AR", { maximumFractionDigits: 1 }));
  const hasMeta = c.conn.meta && daily.length > 0;
  const hasGads = c.conn.google_ads && gadsDaily.length > 0;
  const hasAds = hasMeta || hasGads;
  const adsConnected = c.conn.meta || c.conn.google_ads;
  const sheet = allSales && salesPeriod(allSales, leads, range);
  const sales = sheet ? sheet.sales.length : won;
  const billedArs = sheet ? sheet.ars.total : crm.ticketTotal;
  const billedUsd = sheet ? sheet.usd.total : 0;
  const costPer = (n: number | null, unit: string) =>
    hasAds && n ? ([money(spend / n), `por ${unit}`] as [string, string]) : null;
  const adsMissing = adsConnected ? "Sin datos sincronizados" : "Meta y Google Ads no conectados";
  // Debajo del total, cuánto fue a cada plataforma (solo si hay las dos).
  const split: [string, string] | null =
    c.conn.meta && c.conn.google_ads ? [money(metaSpend), `Meta · ${money(gadsSpend)} Google Ads`] : null;
  const adsSource = c.conn.meta && c.conn.google_ads ? "Meta + Google Ads" : c.conn.google_ads ? "Google Ads" : "Meta";
  const crmMissing = !c.conn.crm ? "CRM no conectado" : "El CRM no informa qué se ganó";
  const steps: Step[] = [
    { label: `Inversión en ${adsSource}`, value: hasAds ? money(spend) : null, cost: split, missing: adsMissing },
    {
      label: `Leads en ${adsSource}`,
      value: hasAds ? leadCount(adLeads) : null,
      // Con las dos plataformas, cuántos vinieron de cada una.
      extra: split ? `Meta ${integer(metaLeads)} · Google ${leadCount(gadsLeads)}` : null,
      cost: costPer(adLeads, "lead"),
      missing: adsMissing,
    },
    {
      label: "Oportunidades en el CRM",
      value: c.conn.crm ? integer(opportunities) : null,
      cost: costPer(opportunities, "oportunidad"),
      missing: "CRM no conectado",
    },
    {
      label: sheet ? "Ventas confirmadas" : "Ventas",
      value: c.conn.crm && sales !== null ? integer(sales) : null,
      cost: costPer(sales, "venta"),
      missing: crmMissing,
    },
    {
      label: "Facturación",
      value: c.conn.crm && sales !== null ? money(billedArs) : null,
      extra: billedUsd ? `+ ${dollars(billedUsd)}` : null,
      cost: hasAds && spend && billedArs ? [ratio(billedArs / spend), "la inversión, en pesos"] : null,
      missing: crmMissing,
    },
  ];

  // Objetivo de facturación (solo equipo): mensual, contra todo lo facturado en el
  // período. Las ventas en dólares se pasan a pesos al dólar oficial (venta) del
  // último día del período: el de hoy si el mes está en curso, el del cierre si ya
  // terminó. Con un rango que no es un mes calendario no hay contra qué comparar.
  const usd = billingGoals && range.month && billedUsd > 0 ? await getUsdRate(range.until) : null;
  const billed = c.conn.crm && sales !== null ? billedArs + (usd ? billedUsd * usd.rate : 0) : null;
  // Hay dólares pero no se pudo leer la cotización: se cuentan solo los pesos y se avisa.
  const usdMissing = billedUsd > 0 && !usd;
  let goalCard: React.ReactNode = null;
  if (billingGoals) {
    const month = range.month ?? null;
    const label = (m: string) => {
      const name = monthName(m);
      return m.slice(0, 4) === todayISO().slice(0, 4) ? name : `${name} ${m.slice(0, 4)}`;
    };
    const goal = month ? goalFor(billingGoals.goals, month) : null;
    const own = month ? (billingGoals.goals[month] ?? null) : null;
    const inherited = goal && goal.from !== month ? { amount: goal.amount, label: label(goal.from) } : null;
    const reached = goal && billed !== null ? billed / goal.amount : null;
    const today = todayISO();
    const daysLeft =
      month && month === today.slice(0, 7)
        ? new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate() - Number(today.slice(8, 10))
        : null;

    goalCard = (
      <Card
        title="Objetivo de facturación"
        action={
          internal && month && !billingGoals.missing ? (
            <BillingGoalEditor clientId={c.id} month={month} monthLabel={label(month)} own={own} inherited={inherited} />
          ) : undefined
        }
        hint={periodo}
      >
        {billingGoals.missing ? (
          <EmptyState label="Pendiente">
            {internal
              ? "Falta correr docs/sql/2026-11-02-objetivo-facturacion.sql en Supabase."
              : "Todavía no hay un objetivo de facturación cargado."}
          </EmptyState>
        ) : !month ? (
          <EmptyState label="Sin datos">El objetivo es mensual: elegí un mes en el período para verlo.</EmptyState>
        ) : !goal ? (
          <EmptyState label="Sin objetivo">Todavía no hay un objetivo de facturación cargado para {label(month)}.</EmptyState>
        ) : (
          <div className="goal">
            <div className="goal-figs">
              <div>
                <div className="label">Objetivo</div>
                <div className="val">{money(goal.amount)}</div>
                <small>{inherited ? `el de ${inherited.label}` : `de ${label(month)}`}</small>
              </div>
              <div>
                <div className="label">Facturado</div>
                <div className="val">{billed !== null ? money(billed) : "—"}</div>
                <small>
                  {billed === null
                    ? crmMissing
                    : usd
                      ? `${money(billedArs)} en pesos + ${dollars(billedUsd)} convertidos`
                      : usdMissing
                        ? `solo pesos: ${dollars(billedUsd)} sin convertir`
                        : sheet
                          ? "según la planilla"
                          : "según el CRM"}
                </small>
              </div>
              <div>
                <div className="label">{reached !== null && reached >= 1 ? "Superado por" : "Falta"}</div>
                <div className="val">{billed !== null ? money(Math.abs(goal.amount - billed)) : "—"}</div>
                <small>
                  {daysLeft !== null ? (daysLeft === 0 ? "hoy termina el mes" : `quedan ${daysLeft} ${daysLeft === 1 ? "día" : "días"}`) : " "}
                </small>
              </div>
            </div>
            {reached !== null && (
              <div className="goal-progress">
                <div className="goal-bar" role="progressbar" aria-valuenow={Math.round(reached * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Avance del objetivo">
                  <span style={{ width: `${Math.min(reached, 1) * 100}%` }} />
                </div>
                <b>{percent(reached * 100)}</b>
              </div>
            )}
            {billed !== null && (usd || usdMissing) && (
              <p className="goal-note">
                {usd ? (
                  <>
                    Las ventas en dólares ({dollars(billedUsd)}) se suman pasadas a pesos al dólar oficial de venta del BNA
                    del {shortDate(usd.date)}: <b>{money(usd.rate)}</b> por dólar, o sea {money(billedUsd * usd.rate)}.
                    {month === todayISO().slice(0, 7) ? " Mientras el mes está en curso se usa la cotización de hoy." : ""}
                  </>
                ) : (
                  "No se pudo leer la cotización del dólar oficial: el avance cuenta solo las ventas en pesos."
                )}
              </p>
            )}
          </div>
        )}
      </Card>
    );
  }

  // Sin integración: el equipo ve el link para conectarla; el cliente, solo el aviso.
  const locked = (label: string, icon: "target" | "users" | "check" | "money", tab: "crm" | "meta") => (
    <KpiLocked
      label={label}
      icon={icon}
      note={`${tab === "crm" ? "CRM" : "Meta"} no conectado${internal ? " · Conectar" : ""}`}
      href={internal ? `${base}/${tab}` : undefined}
    />
  );

  return (
    <>
      {/* El equipo tiene el encabezado, las solapas y el período en clientes/[id]/layout.tsx. */}
      {!internal && (
        <Topbar crumb={c.name} title="Vista general">
          <RangePicker basePath={base} period={range} />
        </Topbar>
      )}
      <section className="view">
        <div className="grid g4 mb-4">
          {!c.conn.crm ? (
            <>
              {locked("Conversión general", "target", "crm")}
              {locked("Ventas", "check", "crm")}
            </>
          ) : sales === null ? (
            <>
              <KpiLocked label="Conversión general" icon="target" note="El CRM no informa qué se ganó" />
              <KpiLocked label="Ventas" icon="check" note="El CRM no informa qué se ganó" />
            </>
          ) : (
            <>
              <Kpi
                label="Conversión general"
                icon="target"
                value={orDash(safeDiv(sales * 100, opportunities), (v) => percent(v))}
                sub={`ventas sobre oportunidades, ${periodo}`}
                hero
              />
              <Kpi
                label={sheet ? "Ventas confirmadas" : "Ventas"}
                icon="check"
                value={integer(sales)}
                sub={`${sheet ? "según la planilla" : `de ${integer(opportunities)} oportunidades`}, ${periodo}`}
              />
            </>
          )}

          {/* Las dos cards suman Meta + Google Ads. Sin ninguna conectada, el link va a META. */}
          {!adsConnected ? (
            locked("Leads generados", "users", "meta")
          ) : hasAds ? (
            <Kpi
              label="Leads generados"
              icon="users"
              value={leadCount(adLeads)}
              sub={split ? `Meta ${integer(metaLeads)} · Google ${leadCount(gadsLeads)}` : `en ${adsSource}, ${periodo}`}
            />
          ) : (
            <KpiLocked label="Leads generados" icon="users" note="Sin datos sincronizados" />
          )}
          {!adsConnected ? (
            locked("Nivel de inversión", "money", "meta")
          ) : hasAds ? (
            <Kpi
              label="Nivel de inversión"
              icon="money"
              value={money(spend)}
              sub={split ? `Meta ${money(metaSpend)} · Google ${money(gadsSpend)}` : `en ${adsSource}, ${periodo}`}
            />
          ) : (
            <KpiLocked label="Nivel de inversión" icon="money" note="Sin datos sincronizados" />
          )}
        </div>

        {/* Apiladas y a todo el ancho: en dos columnas el recorrido de la inversión no entra. */}
        <div className="grid">
          {!adsConnected && !c.conn.crm ? (
            <MissingIntegration kind="meta" client={c} internal={internal} />
          ) : (
            <Card title="Recorrido de la inversión" hint={periodo}>
              <div className="journey">
                {steps.map((step) => (
                  <div key={step.label} className={`journey-step${step.value === null ? " off" : ""}`}>
                    <div className="label">{step.label}</div>
                    <div className="val">
                      {step.value ?? "—"}
                      {step.extra && <small>{step.extra}</small>}
                    </div>
                    <div className="cost">
                      {step.value === null ? (
                        step.missing
                      ) : step.cost ? (
                        <>
                          <b>{step.cost[0]}</b> {step.cost[1]}
                        </>
                      ) : (
                        " "
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <p className="journey-note">
                Los costos son la inversión {c.conn.google_ads ? "total (Meta + Google Ads)" : "en Meta"} dividida por cada
                paso{c.conn.google_ads ? "; los leads de Google Ads son sus conversiones" : ""}. Las
                oportunidades y las ventas incluyen todos los orígenes (orgánico, sin origen cargado), no solo la publicidad.
                {sheet ? " Ventas y facturación según la planilla, por fecha de confirmación; pesos y dólares no se suman." : ""}
              </p>
            </Card>
          )}
          {goalCard}
        </div>
      </section>
    </>
  );
}
