// Lo que Claude recibe para analizar una cuenta de Meta Ads: configuración en vivo
// (campañas, conjuntos, anuncios), rendimiento del período contra el anterior,
// desgaste por semana, cortes de la cuenta y, si el usuario puede ver el CRM, qué
// anuncio trajo ventas. Solo server.
import type { Client, Lead } from "../data";
import { crmPeriod, getLeads, withMetaAdNames } from "../data";
import {
  type AdPeriodInsight,
  type AnalysisInsight,
  getAccountInfo,
  getActiveAdIds,
  getAdPeriodInsights,
  getBreakdownInsights,
  getByIds,
  getCampaignInsights,
  getMetaSecrets,
} from "../meta";
import { type Period, previousPeriod } from "../period";

export class AnalysisDataError extends Error {}

// Tope de anuncios que se mandan con detalle: los de más gasto más los activos.
const MAX_ADS = 60;
// Los textos de los anuncios se recortan: alcanza para juzgar el mensaje.
const TEXT_MAX = 280;

const round = (n: number, digits = 0) => +n.toFixed(digits);
const cut = (text: unknown) => (typeof text === "string" && text.trim() ? text.trim().slice(0, TEXT_MAX) : null);

// Presupuestos: Meta los informa en la unidad mínima de la moneda (centavos).
const budget = (value: unknown) => (value ? Number(value) / 100 : null);

// Métricas derivadas, redondeadas para que el contexto sea corto.
function metrics(i: AnalysisInsight) {
  return {
    gasto: round(i.spend),
    impresiones: i.impressions,
    alcance: i.reach,
    frecuencia: i.frequency ? round(i.frequency, 2) : null,
    clicsEnlace: i.linkClicks,
    ctrEnlacePct: i.impressions ? round((i.linkClicks / i.impressions) * 100, 2) : null,
    cpm: i.impressions ? round((i.spend / i.impressions) * 1000) : null,
    leads: i.leads,
    cpl: i.leads ? round(i.spend / i.leads) : null,
    compras: i.purchases || undefined,
    roas: i.spend && i.revenue ? round(i.revenue / i.spend, 2) : undefined,
  };
}

const sum = (rows: AnalysisInsight[]): AnalysisInsight =>
  rows.reduce(
    (t, r) => ({
      spend: t.spend + r.spend,
      impressions: t.impressions + r.impressions,
      reach: t.reach + r.reach,
      frequency: 0,
      clicks: t.clicks + r.clicks,
      linkClicks: t.linkClicks + r.linkClicks,
      leads: t.leads + r.leads,
      purchases: t.purchases + r.purchases,
      revenue: t.revenue + r.revenue,
    }),
    { spend: 0, impressions: 0, reach: 0, frequency: 0, clicks: 0, linkClicks: 0, leads: 0, purchases: 0, revenue: 0 },
  );

type RawCampaign = {
  name?: string;
  objective?: string;
  effective_status?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  bid_strategy?: string;
  buying_type?: string;
  special_ad_categories?: string[];
};

type RawTargeting = {
  age_min?: number;
  age_max?: number;
  // Con Advantage+ audiencia, el rango que se sugiere (Meta puede salir de él).
  age_range?: number[];
  genders?: number[];
  geo_locations?: {
    countries?: string[];
    regions?: { name?: string }[];
    cities?: { name?: string; radius?: number; distance_unit?: string }[];
    custom_locations?: { name?: string; radius?: number; distance_unit?: string }[];
  };
  flexible_spec?: { interests?: { name?: string }[]; behaviors?: { name?: string }[] }[];
  custom_audiences?: { name?: string }[];
  excluded_custom_audiences?: { name?: string }[];
  publisher_platforms?: string[];
  facebook_positions?: string[];
  instagram_positions?: string[];
  targeting_automation?: { advantage_audience?: number };
};

type RawAdset = {
  name?: string;
  campaign_id?: string;
  effective_status?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  optimization_goal?: string;
  billing_event?: string;
  bid_strategy?: string;
  bid_amount?: number;
  destination_type?: string;
  targeting?: RawTargeting;
  learning_stage_info?: { status?: string };
};

type RawAd = {
  name?: string;
  adset_id?: string;
  effective_status?: string;
  creative?: {
    title?: string;
    body?: string;
    object_type?: string;
    call_to_action_type?: string;
    object_story_spec?: {
      link_data?: { message?: string; name?: string; call_to_action?: { type?: string } };
      video_data?: { message?: string; title?: string; call_to_action?: { type?: string } };
    };
    asset_feed_spec?: { bodies?: { text?: string }[]; titles?: { text?: string }[] };
  };
};

const names = (list: { name?: string }[] | undefined) => (list ?? []).map((x) => x.name).filter(Boolean) as string[];

// Segmentación resumida: lo que sirve para opinar, sin los ids de Meta.
function targetingSummary(t: RawTargeting | undefined) {
  if (!t) return null;
  const geo = t.geo_locations;
  const place = (p: { name?: string; radius?: number; distance_unit?: string }) =>
    p.radius ? `${p.name} (+${p.radius} ${p.distance_unit ?? "km"})` : p.name;
  return {
    edad: t.age_min || t.age_max ? `${t.age_min ?? 18}-${t.age_max ?? 65}` : null,
    edadSugerida: t.age_range?.length === 2 ? `${t.age_range[0]}-${t.age_range[1]}` : undefined,
    sexo: t.genders?.length ? t.genders.map((g) => (g === 1 ? "hombres" : "mujeres")).join(", ") : "todos",
    ubicaciones: [
      ...(geo?.countries ?? []),
      ...names(geo?.regions),
      ...(geo?.cities ?? []).map(place),
      ...(geo?.custom_locations ?? []).map(place),
    ].filter(Boolean),
    intereses: (t.flexible_spec ?? []).flatMap((f) => [...names(f.interests), ...names(f.behaviors)]).slice(0, 25),
    publicos: names(t.custom_audiences),
    publicosExcluidos: names(t.excluded_custom_audiences),
    plataformas: t.publisher_platforms ?? "automáticas (Advantage+)",
    posicionesFacebook: t.facebook_positions,
    posicionesInstagram: t.instagram_positions,
    advantageAudience: t.targeting_automation?.advantage_audience === 1,
  };
}

function creativeSummary(c: RawAd["creative"]) {
  if (!c) return null;
  const link = c.object_story_spec?.link_data;
  const video = c.object_story_spec?.video_data;
  return {
    tipo: video ? "video" : c.object_type ?? null,
    texto: cut(c.body ?? link?.message ?? video?.message ?? c.asset_feed_spec?.bodies?.[0]?.text),
    titulo: cut(c.title ?? link?.name ?? video?.title ?? c.asset_feed_spec?.titles?.[0]?.text),
    variantesDeTexto: c.asset_feed_spec?.bodies?.length || undefined,
    cta: c.call_to_action_type ?? link?.call_to_action?.type ?? video?.call_to_action?.type ?? null,
  };
}

// Ventas del CRM por anuncio en el período (por fecha de venta), con el nombre de Meta.
function crmByAd(leads: Lead[], period: Period, ads: AdPeriodInsight[]) {
  const { ads: crmAds } = crmPeriod(leads, period);
  const metaAds = ads.map((a) => ({ name: a.adName, spend: a.spend }));
  return withMetaAdNames(crmAds, metaAds);
}

export type MetaAnalysisContext = {
  // Nombres que existen en la cuenta: para validar a qué apunta cada recomendación.
  targets: Set<string>;
  context: Record<string, unknown>;
};

export async function buildMetaContext(c: Client, period: Period, seesCrm: boolean): Promise<MetaAnalysisContext> {
  const secrets = await getMetaSecrets(c.id);
  if (!secrets) throw new AnalysisDataError("La sesión de Facebook venció. Volvé a conectar Meta para analizar la cuenta.");
  const account = c.integrations.meta.accountRef;
  if (!account) throw new AnalysisDataError("El cliente no tiene una cuenta publicitaria elegida.");
  const token = secrets.access_token;
  const previous = previousPeriod(period);

  const [info, ads, activeIds, campaignsNow, campaignsBefore, weekly, ageGender, placements, devices] = await Promise.all([
    getAccountInfo(token, account),
    getAdPeriodInsights(token, account, period.since, period.until),
    getActiveAdIds(token, account).catch(() => [] as string[]),
    getCampaignInsights(token, account, period.since, period.until),
    getCampaignInsights(token, account, previous.since, previous.until).catch(() => []),
    getCampaignInsights(token, account, period.since, period.until, true).catch(() => []),
    getBreakdownInsights(token, account, period.since, period.until, "age,gender").catch(() => []),
    getBreakdownInsights(token, account, period.since, period.until, "publisher_platform,platform_position").catch(() => []),
    getBreakdownInsights(token, account, period.since, period.until, "device_platform").catch(() => []),
  ]);

  if (!ads.length && !activeIds.length) {
    throw new AnalysisDataError("La cuenta no tuvo entrega en el período ni tiene anuncios activos: no hay nada para analizar.");
  }

  // Los de más gasto del período más los activos hoy, sin pasarse del tope.
  const bySpend = [...ads].sort((a, b) => b.spend - a.spend);
  const adIds = [...new Set([...bySpend.map((a) => a.adId), ...activeIds])].slice(0, MAX_ADS);
  const adDetails = await getByIds<RawAd>(
    token,
    account,
    "ads",
    adIds,
    "name,adset_id,effective_status,creative{title,body,object_type,call_to_action_type,object_story_spec{link_data{message,name,call_to_action{type}},video_data{message,title,call_to_action{type}}},asset_feed_spec{bodies{text},titles{text}}}",
  ).catch(() => getByIds<RawAd>(token, account, "ads", adIds, "name,adset_id,effective_status"));

  const adsetIds = [...new Set([...adDetails.map((a) => a.adset_id), ...ads.map((a) => a.adsetId)].filter(Boolean) as string[])];
  const adsets = await getByIds<RawAdset>(
    token,
    account,
    "adsets",
    adsetIds,
    "name,campaign_id,effective_status,daily_budget,lifetime_budget,optimization_goal,billing_event,bid_strategy,bid_amount,destination_type,targeting,learning_stage_info",
  );
  const campaignIds = [
    ...new Set([...adsets.map((s) => s.campaign_id), ...campaignsNow.map((x) => x.campaignId)].filter(Boolean) as string[]),
  ];
  const campaigns = await getByIds<RawCampaign>(
    token,
    account,
    "campaigns",
    campaignIds,
    "name,objective,effective_status,daily_budget,lifetime_budget,bid_strategy,buying_type,special_ad_categories",
  );

  // CRM: solo si el usuario puede verlo y el cliente lo tiene conectado.
  const crm = seesCrm && c.conn.crm ? crmByAd(await getLeads(c.id), period, ads) : null;
  const crmOf = new Map((crm ?? []).map((a) => [a.name.trim().toUpperCase(), a]));

  const perfOfAd = new Map(ads.map((a) => [a.adId, a]));
  const adsOfAdset = new Map<string, string[]>();
  for (const ad of adDetails) {
    if (!ad.adset_id) continue;
    adsOfAdset.set(ad.adset_id, [...(adsOfAdset.get(ad.adset_id) ?? []), ad.id]);
  }
  const adsetsOfCampaign = new Map<string, (RawAdset & { id: string })[]>();
  for (const s of adsets) {
    if (!s.campaign_id) continue;
    adsetsOfCampaign.set(s.campaign_id, [...(adsetsOfCampaign.get(s.campaign_id) ?? []), s]);
  }
  const now = new Map(campaignsNow.map((x) => [x.campaignId, x]));
  const before = new Map(campaignsBefore.map((x) => [x.campaignId, x]));

  const targets = new Set<string>();
  const adDetail = new Map(adDetails.map((a) => [a.id, a]));

  const structure = campaigns
    .map((camp) => {
      targets.add(camp.name ?? camp.id);
      return {
        campania: camp.name ?? camp.id,
        estado: camp.effective_status,
        objetivo: camp.objective,
        presupuestoDiario: budget(camp.daily_budget),
        presupuestoTotal: budget(camp.lifetime_budget),
        estrategiaDePuja: camp.bid_strategy,
        categoriaEspecial: camp.special_ad_categories?.length ? camp.special_ad_categories : undefined,
        periodo: now.get(camp.id) ? metrics(now.get(camp.id)!) : "sin entrega",
        periodoAnterior: before.get(camp.id) ? metrics(before.get(camp.id)!) : "sin entrega",
        porSemana: weekly
          .filter((w) => w.campaignId === camp.id)
          .map((w) => ({ desde: w.start, ...metrics(w) }))
          .map(({ desde, gasto, frecuencia, ctrEnlacePct, cpl, leads }) => ({ desde, gasto, frecuencia, ctrEnlacePct, leads, cpl })),
        conjuntos: (adsetsOfCampaign.get(camp.id) ?? []).map((s) => {
          targets.add(s.name ?? s.id);
          const adsHere = (adsOfAdset.get(s.id) ?? []).map((id) => adDetail.get(id)!).filter(Boolean);
          const perfHere = ads.filter((a) => a.adsetId === s.id);
          return {
            conjunto: s.name ?? s.id,
            estado: s.effective_status,
            aprendizaje: s.learning_stage_info?.status,
            optimizacion: s.optimization_goal,
            destino: s.destination_type,
            presupuestoDiario: budget(s.daily_budget),
            presupuestoTotal: budget(s.lifetime_budget),
            estrategiaDePuja: s.bid_strategy,
            segmentacion: targetingSummary(s.targeting),
            periodo: perfHere.length ? metrics(sum(perfHere)) : "sin entrega",
            anuncios: adsHere.map((ad) => {
              const name = ad.name ?? ad.id;
              targets.add(name);
              const perf = perfOfAd.get(ad.id);
              const sales = crmOf.get(name.trim().toUpperCase());
              return {
                anuncio: name,
                estado: ad.effective_status,
                creatividad: creativeSummary(ad.creative),
                periodo: perf ? metrics(perf) : "sin entrega",
                crm: sales
                  ? { oportunidades: sales.leads, ventas: sales.won, facturacion: Math.round(sales.ticketTotal) || undefined }
                  : undefined,
              };
            }),
          };
        }),
      };
    })
    // Primero las que gastaron más.
    .sort((a, b) => (typeof b.periodo === "string" ? 0 : b.periodo.gasto) - (typeof a.periodo === "string" ? 0 : a.periodo.gasto));

  const total = sum(ads);
  const totalBefore = sum(campaignsBefore);
  const segment = (rows: (AnalysisInsight & { segment: string })[]) =>
    rows
      .filter((r) => r.spend > 0)
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 15)
      .map((r) => ({ segmento: r.segment, ...metrics(r) }));

  return {
    targets,
    context: {
      cliente: c.name,
      rubro: c.sector,
      plataforma: "Meta Ads (Facebook e Instagram)",
      cuenta: info.name,
      moneda: info.currency,
      periodo: { desde: period.since, hasta: period.until, anterior: { desde: previous.since, hasta: previous.until } },
      totales: { periodo: metrics(total), periodoAnterior: totalBefore.spend ? metrics(totalBefore) : "sin entrega" },
      estructura: structure,
      cortes: { edadYSexo: segment(ageGender), ubicaciones: segment(placements), dispositivos: segment(devices) },
      crm: crm
        ? {
            nota: "Oportunidades y ventas del CRM del cliente atribuidas a cada anuncio (campo anuncio del lead), en el mismo período; las ventas van por fecha de venta. Están dentro de cada anuncio como 'crm'. Un anuncio sin 'crm' no tiene leads cargados con ese anuncio en el CRM, lo que no prueba que no vendió.",
            anunciosConDatos: crm.length,
          }
        : seesCrm
          ? "El cliente no tiene CRM conectado."
          : "No disponible para este usuario.",
      anunciosIncluidos: `${adIds.length} (los de más gasto del período y los activos hoy, tope ${MAX_ADS})`,
    },
  };
}
