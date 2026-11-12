// Lo que Claude recibe para analizar una cuenta de Google Ads: configuración en
// vivo (campañas, grupos de anuncios, grupos de recursos de Máximo rendimiento,
// palabras clave, anuncios), términos de búsqueda, rendimiento del período contra
// el anterior, evolución por semana, acciones de conversión y cortes de la cuenta.
// No se guarda nada: se consulta la API en el momento. Solo server.
import type { Client } from "../data";
import { type AdsMetrics, between, GoogleAdsError, gaql, METRIC_FIELDS, type RawMetrics, toMetrics } from "../google-ads";
import { type Period, previousPeriod } from "../period";
import { AnalysisDataError } from "./meta-data";

// Topes para que el contexto no se vaya de tamaño: los de más gasto.
const MAX_KEYWORDS = 80;
const MAX_SEARCH_TERMS = 80;
const MAX_ADS = 40;

const round = (n: number, digits = 0) => +n.toFixed(digits);
const micros = (v: unknown) => (v ? round(Number(v) / 1_000_000, 2) : null);

// Métricas derivadas, redondeadas para que el contexto sea corto.
function metrics(m: AdsMetrics) {
  // Sin valores cargados, Google le pone 1 a cada conversión: ese "valor" no es
  // plata y el ROAS daría 0, así que no se manda.
  const hasValue = m.conversions_value > 0 && Math.abs(m.conversions_value - m.conversions) > 0.01;
  return {
    gasto: round(m.cost),
    impresiones: m.impressions,
    clics: m.clicks,
    ctrPct: m.impressions ? round((m.clicks / m.impressions) * 100, 2) : null,
    cpc: m.clicks ? round(m.cost / m.clicks, 2) : null,
    conversiones: m.conversions,
    costoPorConversion: m.conversions ? round(m.cost / m.conversions) : null,
    valorConversiones: hasValue ? round(m.conversions_value) : undefined,
    roas: hasValue && m.cost ? round(m.conversions_value / m.cost, 2) : undefined,
  };
}

const sum = (rows: AdsMetrics[]): AdsMetrics =>
  rows.reduce(
    (t, r) => ({
      impressions: t.impressions + r.impressions,
      clicks: t.clicks + r.clicks,
      cost: t.cost + r.cost,
      conversions: t.conversions + r.conversions,
      conversions_value: t.conversions_value + r.conversions_value,
    }),
    { impressions: 0, clicks: 0, cost: 0, conversions: 0, conversions_value: 0 },
  );

const pct = (v: unknown) => (typeof v === "number" ? round(v * 100, 1) : undefined);

type Named = { id?: string; name?: string };
type CampaignRow = {
  campaign?: Named & {
    status?: string;
    primaryStatus?: string;
    primaryStatusReasons?: string[];
    advertisingChannelType?: string;
    biddingStrategyType?: string;
    targetCpa?: { targetCpaMicros?: string };
    targetRoas?: { targetRoas?: number };
    maximizeConversions?: { targetCpaMicros?: string };
    maximizeConversionValue?: { targetRoas?: number };
    networkSettings?: { targetSearchNetwork?: boolean; targetContentNetwork?: boolean; targetPartnerSearchNetwork?: boolean };
  };
  campaignBudget?: { amountMicros?: string };
};
type CampaignPerfRow = {
  campaign?: Named;
  segments?: { week?: string };
  metrics?: RawMetrics & {
    searchImpressionShare?: number;
    searchBudgetLostImpressionShare?: number;
    searchRankLostImpressionShare?: number;
  };
};
type AdGroupRow = {
  campaign?: Named;
  adGroup?: Named & { status?: string; type?: string; cpcBidMicros?: string; targetCpaMicros?: string };
  metrics?: RawMetrics;
};
type AssetGroupRow = { campaign?: Named; assetGroup?: Named & { status?: string; adStrength?: string }; metrics?: RawMetrics };
type KeywordRow = {
  campaign?: Named;
  adGroup?: Named;
  adGroupCriterion?: { status?: string; keyword?: { text?: string; matchType?: string }; qualityInfo?: { qualityScore?: number } };
  metrics?: RawMetrics;
};
type SearchTermRow = { campaign?: Named; adGroup?: Named; searchTermView?: { searchTerm?: string; status?: string }; metrics?: RawMetrics };
type AdRow = {
  campaign?: Named;
  adGroup?: Named;
  adGroupAd?: {
    status?: string;
    adStrength?: string;
    policySummary?: { approvalStatus?: string };
    ad?: Named & {
      type?: string;
      finalUrls?: string[];
      responsiveSearchAd?: { headlines?: { text?: string }[]; descriptions?: { text?: string }[] };
    };
  };
  metrics?: RawMetrics;
};
type ConversionActionRow = {
  conversionAction?: { name?: string; category?: string; status?: string; primaryForGoal?: boolean; countingType?: string };
};
type ConversionsByActionRow = { segments?: { conversionActionName?: string }; metrics?: { conversions?: number; allConversions?: number } };
type SegmentRow = {
  segments?: { device?: string; dayOfWeek?: string };
  adGroupCriterion?: { ageRange?: { type?: string }; gender?: { type?: string } };
  metrics?: RawMetrics;
};

const quiet = <T>(p: Promise<T[]>) => p.catch(() => [] as T[]);

// Suma filas por una clave (las vistas de edad y sexo vienen por grupo de anuncios).
function bySegment<T extends { metrics?: RawMetrics }>(rows: T[], key: (r: T) => string | undefined) {
  const groups = new Map<string, AdsMetrics[]>();
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    groups.set(k, [...(groups.get(k) ?? []), toMetrics(r.metrics)]);
  }
  return [...groups]
    .map(([segmento, list]) => ({ segmento, total: sum(list) }))
    .filter((s) => s.total.cost > 0)
    .sort((a, b) => b.total.cost - a.total.cost)
    .slice(0, 15)
    .map(({ segmento, total }) => ({ segmento, ...metrics(total) }));
}

// Un anuncio de Google casi nunca tiene nombre: se lo identifica por su primer
// título y su id, y así se lo nombra también en las recomendaciones.
const adLabel = (ad: NonNullable<NonNullable<AdRow["adGroupAd"]>["ad"]>) => {
  if (ad.name?.trim()) return ad.name.trim();
  const headline = ad.responsiveSearchAd?.headlines?.[0]?.text?.trim();
  return headline ? `"${headline}" (id ${ad.id})` : `Anuncio ${ad.id}`;
};

export type GadsAnalysisContext = { targets: Set<string>; context: Record<string, unknown> };

export async function buildGadsContext(c: Client, period: Period): Promise<GadsAnalysisContext> {
  const customerId = c.integrations.google_ads.accountRef;
  if (!customerId) throw new AnalysisDataError("El cliente no tiene una cuenta de Google Ads elegida.");
  const previous = previousPeriod(period);
  const now = between(period.since, period.until);
  const before = between(previous.since, previous.until);

  const read = async () =>
    Promise.all([
      gaql<{ customer?: { descriptiveName?: string; currencyCode?: string } }>(
        customerId,
        "SELECT customer.descriptive_name, customer.currency_code FROM customer",
      ),
      gaql<CampaignRow>(
        customerId,
        "SELECT campaign.id, campaign.name, campaign.status, campaign.primary_status, campaign.primary_status_reasons, " +
          "campaign.advertising_channel_type, campaign.bidding_strategy_type, campaign.target_cpa.target_cpa_micros, " +
          "campaign.target_roas.target_roas, campaign.maximize_conversions.target_cpa_micros, " +
          "campaign.maximize_conversion_value.target_roas, campaign.network_settings.target_search_network, " +
          "campaign.network_settings.target_content_network, campaign.network_settings.target_partner_search_network, " +
          "campaign_budget.amount_micros FROM campaign WHERE campaign.status != 'REMOVED'",
      ),
      gaql<CampaignPerfRow>(
        customerId,
        `SELECT campaign.id, ${METRIC_FIELDS}, metrics.search_impression_share, metrics.search_budget_lost_impression_share, ` +
          `metrics.search_rank_lost_impression_share FROM campaign WHERE ${now} AND metrics.impressions > 0`,
      ).catch(() =>
        gaql<CampaignPerfRow>(customerId, `SELECT campaign.id, ${METRIC_FIELDS} FROM campaign WHERE ${now} AND metrics.impressions > 0`),
      ),
      quiet(gaql<CampaignPerfRow>(customerId, `SELECT campaign.id, ${METRIC_FIELDS} FROM campaign WHERE ${before} AND metrics.impressions > 0`)),
      quiet(
        gaql<CampaignPerfRow>(
          customerId,
          `SELECT campaign.id, segments.week, ${METRIC_FIELDS} FROM campaign WHERE ${now} AND metrics.impressions > 0`,
        ),
      ),
      quiet(
        gaql<AdGroupRow>(
          customerId,
          `SELECT campaign.id, ad_group.id, ad_group.name, ad_group.status, ad_group.type, ad_group.cpc_bid_micros, ` +
            `ad_group.target_cpa_micros, ${METRIC_FIELDS} FROM ad_group WHERE ${now} AND ad_group.status != 'REMOVED' ` +
            `AND campaign.status != 'REMOVED'`,
        ),
      ),
      quiet(
        gaql<AssetGroupRow>(
          customerId,
          `SELECT campaign.id, asset_group.id, asset_group.name, asset_group.status, asset_group.ad_strength, ${METRIC_FIELDS} ` +
            `FROM asset_group WHERE ${now} AND asset_group.status != 'REMOVED'`,
        ),
      ),
      quiet(
        gaql<KeywordRow>(
          customerId,
          `SELECT campaign.id, ad_group.id, ad_group_criterion.status, ad_group_criterion.keyword.text, ` +
            `ad_group_criterion.keyword.match_type, ad_group_criterion.quality_info.quality_score, ${METRIC_FIELDS} ` +
            `FROM keyword_view WHERE ${now} AND metrics.impressions > 0 ORDER BY metrics.cost_micros DESC LIMIT ${MAX_KEYWORDS}`,
        ),
      ),
      quiet(
        gaql<SearchTermRow>(
          customerId,
          `SELECT campaign.name, ad_group.name, search_term_view.search_term, search_term_view.status, ${METRIC_FIELDS} ` +
            `FROM search_term_view WHERE ${now} AND metrics.cost_micros > 0 ORDER BY metrics.cost_micros DESC LIMIT ${MAX_SEARCH_TERMS}`,
        ),
      ),
      quiet(
        gaql<AdRow>(
          customerId,
          `SELECT campaign.id, ad_group.id, ad_group_ad.status, ad_group_ad.ad_strength, ad_group_ad.policy_summary.approval_status, ` +
            `ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type, ad_group_ad.ad.final_urls, ` +
            `ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions, ${METRIC_FIELDS} ` +
            `FROM ad_group_ad WHERE ${now} AND ad_group_ad.status != 'REMOVED' AND metrics.impressions > 0 ` +
            `ORDER BY metrics.cost_micros DESC LIMIT ${MAX_ADS}`,
        ),
      ),
      quiet(
        gaql<ConversionActionRow>(
          customerId,
          "SELECT conversion_action.name, conversion_action.category, conversion_action.status, " +
            "conversion_action.primary_for_goal, conversion_action.counting_type FROM conversion_action " +
            "WHERE conversion_action.status = 'ENABLED'",
        ),
      ),
      quiet(
        gaql<ConversionsByActionRow>(
          customerId,
          `SELECT segments.conversion_action_name, metrics.conversions, metrics.all_conversions FROM customer WHERE ${now}`,
        ),
      ),
      quiet(gaql<SegmentRow>(customerId, `SELECT segments.device, ${METRIC_FIELDS} FROM customer WHERE ${now}`)),
      quiet(gaql<SegmentRow>(customerId, `SELECT segments.day_of_week, ${METRIC_FIELDS} FROM customer WHERE ${now}`)),
      quiet(gaql<SegmentRow>(customerId, `SELECT ad_group_criterion.age_range.type, ${METRIC_FIELDS} FROM age_range_view WHERE ${now}`)),
      quiet(gaql<SegmentRow>(customerId, `SELECT ad_group_criterion.gender.type, ${METRIC_FIELDS} FROM gender_view WHERE ${now}`)),
    ]);

  const [
    [customer],
    campaigns,
    campaignsNow,
    campaignsBefore,
    weekly,
    adGroups,
    assetGroups,
    keywords,
    searchTerms,
    ads,
    conversionActions,
    conversionsByAction,
    devices,
    days,
    ages,
    genders,
  ] = await read().catch((e) => {
    if (e instanceof GoogleAdsError) throw new AnalysisDataError(e.message);
    throw e;
  });

  const activeCampaigns = campaigns.filter((x) => x.campaign?.status === "ENABLED");
  if (!campaignsNow.length && !activeCampaigns.length) {
    throw new AnalysisDataError("La cuenta no tuvo entrega en el período ni tiene campañas activas: no hay nada para analizar.");
  }

  const perfNow = new Map(campaignsNow.map((r) => [String(r.campaign?.id), r]));
  const perfBefore = new Map(campaignsBefore.map((r) => [String(r.campaign?.id), toMetrics(r.metrics)]));
  const targets = new Set<string>();
  const nameOf = new Map(campaigns.map((r) => [String(r.campaign?.id), r.campaign?.name ?? `Campaña ${r.campaign?.id}`]));
  const adGroupName = new Map(adGroups.map((r) => [String(r.adGroup?.id), r.adGroup?.name ?? `Grupo ${r.adGroup?.id}`]));

  // Las campañas activas y las que gastaron en el período (una pausada a mitad de mes también cuenta).
  const structure = campaigns
    .filter((r) => r.campaign?.status === "ENABLED" || perfNow.has(String(r.campaign?.id)))
    .map((r) => {
      const camp = r.campaign!;
      const id = String(camp.id);
      const name = nameOf.get(id)!;
      targets.add(name);
      const perf = perfNow.get(id);
      const m = perf?.metrics;
      const net = camp.networkSettings;
      return {
        campania: name,
        estado: camp.status,
        estadoDetalle: camp.primaryStatus,
        motivosEstado: camp.primaryStatusReasons?.length ? camp.primaryStatusReasons : undefined,
        tipo: camp.advertisingChannelType,
        estrategiaDePuja: camp.biddingStrategyType,
        cpaObjetivo: micros(camp.targetCpa?.targetCpaMicros ?? camp.maximizeConversions?.targetCpaMicros) ?? undefined,
        roasObjetivo: camp.targetRoas?.targetRoas ?? camp.maximizeConversionValue?.targetRoas ?? undefined,
        presupuestoDiario: micros(r.campaignBudget?.amountMicros),
        redes:
          camp.advertisingChannelType === "SEARCH" && net
            ? { busqueda: net.targetSearchNetwork, sociosDeBusqueda: net.targetPartnerSearchNetwork, display: net.targetContentNetwork }
            : undefined,
        cuotaDeImpresionesPct: m?.searchImpressionShare != null
          ? {
              obtenida: pct(m.searchImpressionShare),
              perdidaPorPresupuesto: pct(m.searchBudgetLostImpressionShare),
              perdidaPorRanking: pct(m.searchRankLostImpressionShare),
            }
          : undefined,
        periodo: perf ? metrics(toMetrics(m)) : "sin entrega",
        periodoAnterior: perfBefore.has(id) ? metrics(perfBefore.get(id)!) : "sin entrega",
        porSemana: weekly
          .filter((w) => String(w.campaign?.id) === id)
          .sort((a, b) => (a.segments?.week ?? "").localeCompare(b.segments?.week ?? ""))
          .map((w) => {
            const x = metrics(toMetrics(w.metrics));
            return { desde: w.segments?.week, gasto: x.gasto, clics: x.clics, ctrPct: x.ctrPct, conversiones: x.conversiones, costoPorConversion: x.costoPorConversion };
          }),
        gruposDeAnuncios: adGroups
          .filter((g) => String(g.campaign?.id) === id)
          .map((g) => {
            const gname = adGroupName.get(String(g.adGroup?.id))!;
            targets.add(gname);
            return {
              grupo: gname,
              estado: g.adGroup?.status,
              tipo: g.adGroup?.type,
              cpcMaximo: micros(g.adGroup?.cpcBidMicros) ?? undefined,
              cpaObjetivo: micros(g.adGroup?.targetCpaMicros) ?? undefined,
              periodo: metrics(toMetrics(g.metrics)),
            };
          })
          .sort((a, b) => b.periodo.gasto - a.periodo.gasto),
        gruposDeRecursos: assetGroups
          .filter((g) => String(g.campaign?.id) === id)
          .map((g) => {
            const gname = g.assetGroup?.name ?? `Grupo de recursos ${g.assetGroup?.id}`;
            targets.add(gname);
            return { grupo: gname, estado: g.assetGroup?.status, calidad: g.assetGroup?.adStrength, periodo: metrics(toMetrics(g.metrics)) };
          }),
      };
    })
    .map((x) => ({
      ...x,
      gruposDeAnuncios: x.gruposDeAnuncios.length ? x.gruposDeAnuncios : undefined,
      gruposDeRecursos: x.gruposDeRecursos.length ? x.gruposDeRecursos : undefined,
    }))
    // Primero las que gastaron más.
    .sort((a, b) => (typeof b.periodo === "string" ? 0 : b.periodo.gasto) - (typeof a.periodo === "string" ? 0 : a.periodo.gasto));

  const keywordList = keywords.map((k) => {
    const text = k.adGroupCriterion?.keyword?.text ?? "";
    if (text) targets.add(text);
    return {
      palabraClave: text,
      concordancia: k.adGroupCriterion?.keyword?.matchType,
      estado: k.adGroupCriterion?.status,
      nivelDeCalidad: k.adGroupCriterion?.qualityInfo?.qualityScore,
      campania: nameOf.get(String(k.campaign?.id)),
      grupo: adGroupName.get(String(k.adGroup?.id)),
      ...metrics(toMetrics(k.metrics)),
    };
  });

  const adList = ads.map((a) => {
    const ad = a.adGroupAd?.ad ?? {};
    const label = adLabel(ad);
    targets.add(label);
    return {
      anuncio: label,
      tipo: ad.type,
      estado: a.adGroupAd?.status,
      aprobacion: a.adGroupAd?.policySummary?.approvalStatus,
      calidadDelAnuncio: a.adGroupAd?.adStrength,
      campania: nameOf.get(String(a.campaign?.id)),
      grupo: adGroupName.get(String(a.adGroup?.id)),
      titulos: ad.responsiveSearchAd?.headlines?.map((h) => h.text).filter(Boolean),
      descripciones: ad.responsiveSearchAd?.descriptions?.map((d) => d.text).filter(Boolean),
      urlFinal: ad.finalUrls?.[0],
      ...metrics(toMetrics(a.metrics)),
    };
  });

  const total = sum(campaignsNow.map((r) => toMetrics(r.metrics)));
  const totalBefore = sum([...perfBefore.values()]);

  return {
    targets,
    context: {
      cliente: c.name,
      rubro: c.sector,
      plataforma: "Google Ads",
      cuenta: customer?.customer?.descriptiveName ?? customerId,
      moneda: customer?.customer?.currencyCode,
      periodo: { desde: period.since, hasta: period.until, anterior: { desde: previous.since, hasta: previous.until } },
      totales: { periodo: metrics(total), periodoAnterior: totalBefore.cost ? metrics(totalBefore) : "sin entrega" },
      estructura: structure,
      palabrasClave: keywordList.length ? keywordList : "Sin palabras clave con impresiones en el período.",
      terminosDeBusqueda: searchTerms.length
        ? searchTerms.map((t) => ({
            termino: t.searchTermView?.searchTerm,
            estado: t.searchTermView?.status,
            campania: t.campaign?.name,
            grupo: t.adGroup?.name,
            ...metrics(toMetrics(t.metrics)),
          }))
        : "Sin términos de búsqueda con gasto en el período.",
      anuncios: adList,
      conversiones: {
        accionesActivas: conversionActions.map((x) => ({
          nombre: x.conversionAction?.name,
          categoria: x.conversionAction?.category,
          primaria: x.conversionAction?.primaryForGoal,
          conteo: x.conversionAction?.countingType,
        })),
        porAccionEnElPeriodo: conversionsByAction
          .filter((x) => x.segments?.conversionActionName && (x.metrics?.allConversions || x.metrics?.conversions))
          .map((x) => ({
            accion: x.segments!.conversionActionName,
            conversiones: round(x.metrics?.conversions ?? 0, 2),
            todasLasConversiones: round(x.metrics?.allConversions ?? 0, 2),
          })),
      },
      cortes: {
        dispositivos: bySegment(devices, (r) => r.segments?.device),
        diaDeLaSemana: bySegment(days, (r) => r.segments?.dayOfWeek),
        edad: bySegment(ages, (r) => r.adGroupCriterion?.ageRange?.type),
        sexo: bySegment(genders, (r) => r.adGroupCriterion?.gender?.type),
      },
      limites: `Palabras clave: las ${MAX_KEYWORDS} de más gasto. Términos de búsqueda: los ${MAX_SEARCH_TERMS} de más gasto. Anuncios: los ${MAX_ADS} de más gasto.`,
      crm: "Las ventas del CRM no se cruzan con Google Ads: juzgá por las conversiones que mide Google.",
    },
  };
}
