// Textos de análisis del reporte, escritos por Claude a partir de los números
// ya calculados (lib/report/data.ts). Solo server: usa ANTHROPIC_API_KEY.
//
// El modelo no inventa datos: recibe solo el resumen del período y devuelve
// JSON con un esquema fijo (structured outputs). Los textos pueden marcar
// énfasis con **negrita**; el HTML lo escapa y lo convierte en <strong>.
import Anthropic from "@anthropic-ai/sdk";
import { addUsage, emptyTokens, recordUsage } from "../agent/usage";
import { aiChoice, effortParam } from "../ai-config";
import type { ReportData } from "./data";

export type ReportTexts = {
  reading: string;
  bottleneck: string;
  sources: string;
  traffic: string;
  behavior: string;
  nextSteps: { priority: string; title: string; detail: string; debate: boolean }[];
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reading", "bottleneck", "sources", "traffic", "behavior", "nextSteps"],
  properties: {
    reading: { type: "string", description: "Lectura del período: 2 a 4 oraciones sobre la pauta." },
    bottleneck: { type: "string", description: "Callout sobre dónde se acumula el pipeline. Vacío si no hay CRM." },
    sources: { type: "string", description: "Nota sobre el canal de las oportunidades. Vacío si no hay CRM." },
    traffic: { type: "string", description: "Nota sobre el origen del tráfico web. Vacío si no hay datos de origen." },
    behavior: { type: "string", description: "Nota sobre el comportamiento en el sitio. Vacío si no hay Clarity." },
    nextSteps: {
      type: "array",
      description: "Entre 3 y 5 próximos pasos, del de más impacto al de menos.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["priority", "title", "detail", "debate"],
        properties: {
          priority: { type: "string", description: 'Ej.: "Prioridad 1" o "Prioridad 2 · a debatir".' },
          title: { type: "string", description: "Hasta 7 palabras." },
          detail: {
            type: "string",
            description: "2 oraciones, entre 30 y 45 palabras. Todos los pasos de largo parecido: se muestran en tarjetas de igual alto.",
          },
          debate: { type: "boolean", description: "true si es una pregunta abierta para discutir con el cliente." },
        },
      },
    },
  },
} as const;

const SYSTEM = `Sos analista de performance en Qualita Studio, una agencia de branding y performance de Argentina. Escribís los textos de análisis de un reporte para un cliente: español rioplatense (voseo), tono profesional y directo, sin marketing vacío.

Reglas:
- Usá solo los números del resumen que te pasan. No inventes datos, comparaciones ni causas que no se desprendan de ellos; si algo es una hipótesis, decilo como tal.
- Números en formato argentino ($1.234.567, 12,5%).
- Podés resaltar lo importante con **negrita**. No uses otro formato (ni listas, ni títulos, ni HTML).
- Si una sección no tiene datos en el resumen (valor null), devolvé "" en su texto.
- Google Ads todavía no está conectado: no lo analices; como mucho mencioná que está pendiente.
- Los próximos pasos tienen que ser accionables y salir de lo que muestran los datos.

Ejemplo del estilo esperado (de otro reporte, no copies sus números):
- Lectura: "En el período se invirtieron **$2.171.390** entre Meta y Google, con **111 leads** a un CPL promedio de **$19.562**. El foco del mes fue acumular volumen de leads con el píxel y el tracking recién montados, sin tocar presupuestos."
- Cuello de botella: "**91% del pipeline** — 144 de 159 oportunidades están en estas tres etapas tempranas. Es sano para leads tan nuevos, pero es el punto donde más se pierde."
- Próximo paso: { "priority": "Prioridad 3", "title": "Emparejar el avance del equipo", "detail": "Anabella y Camila concentran 119 de 159 leads (75%) con las tasas de confirmación más bajas, mientras Gustavo confirma al 26%. Documentar cómo cotiza y sigue el que más convierte.", "debate": false }`;

// Resumen para el modelo: lo mismo que el reporte, sin las imágenes.
function summary(data: ReportData) {
  const { meta, crm, clarity } = data;
  return {
    cliente: data.client.name,
    periodo: data.period.range,
    moneda: "ARS",
    googleAds: "no conectado",
    meta: meta && {
      inversion: Math.round(meta.spend),
      leads: meta.leads,
      cpl: meta.leads ? Math.round(meta.spend / meta.leads) : null,
      impresiones: meta.impressions,
      clics: meta.clicks,
      campanias: meta.campaigns.map((c) => ({
        nombre: c.name,
        inversion: Math.round(c.spend),
        leads: c.leads,
        cpl: c.leads ? Math.round(c.spend / c.leads) : null,
        ctr: c.impressions ? +((c.clicks / c.impressions) * 100).toFixed(2) : null,
      })),
      creativos: meta.creativeGroups.map((g) => ({
        campania: g.campaign,
        anuncios: g.ads.map((a) => ({ nombre: a.name, leads: a.leads, cpl: a.cpl && Math.round(a.cpl) })),
      })),
    },
    crm: crm && {
      oportunidades: crm.total,
      pulso: crm.pulse,
      porSemana: crm.weeks,
      aceleracion: crm.split,
      etapasConMasOportunidades: crm.bottleneck.map((b) => ({ ...b, share: Math.round(b.share) })),
      tiempoDeRespuesta: crm.response && {
        etapa: crm.response.stage,
        medianaHoras: +crm.response.medianHours.toFixed(1),
        contactadosEn24h: crm.response.within24,
        tardaronMasDe3Dias: crm.response.over3Days,
        muestra: crm.response.sample,
      },
      vendedores: crm.sellers?.map((s) => ({ ...s, pct: +s.pct.toFixed(1) })) ?? null,
      origen: crm.sources,
      conOrigenCargado: crm.sourcesKnown,
      ventas: crm.sales && { ...crm.sales, total: Math.round(crm.sales.total), average: crm.sales.average && Math.round(crm.sales.average) },
    },
    clarity: clarity && {
      desde: clarity.from,
      hasta: clarity.to,
      sesiones: clarity.sessions,
      usuarios: clarity.users,
      paginasPorSesion: clarity.pagesPerSession && +clarity.pagesPerSession.toFixed(1),
      tiempoActivoSegundos: clarity.activeTime && Math.round(clarity.activeTime),
      scrollPromedio: clarity.scroll && Math.round(clarity.scroll),
      paginaMasVista: clarity.topPage,
      origenDelTrafico: clarity.sources.length ? clarity.sources.map((s) => ({ ...s, share: Math.round(s.share) })) : null,
      mobile: clarity.mobileShare && Math.round(clarity.mobileShare),
    },
  };
}

// En streaming y con el razonamiento resumido visible: el modal de la solapa
// Reportes lo muestra mientras Claude escribe (onThinking).
export async function writeReportTexts(
  data: ReportData,
  userId: string,
  onThinking?: (text: string) => void,
): Promise<ReportTexts> {
  const ai = await aiChoice("reporte");
  const client = new Anthropic();
  const stream = client.messages.stream({
    model: ai.model,
    max_tokens: 16000,
    system: SYSTEM,
    thinking: { type: "adaptive", display: "summarized" },
    output_config: { ...effortParam(ai), format: { type: "json_schema", schema: SCHEMA } },
    messages: [
      {
        role: "user",
        content: `Resumen del período (JSON):\n${JSON.stringify(summary(data), null, 2)}\n\nEscribí los textos del reporte.`,
      },
    ],
  });
  if (onThinking) {
    stream.on("streamEvent", (event) => {
      if (event.type === "content_block_delta" && event.delta.type === "thinking_delta") onThinking(event.delta.thinking);
    });
  }
  const response = await stream.finalMessage();

  await recordUsage("reporte", userId, null, ai.model, addUsage(emptyTokens(), response.usage));

  if (response.stop_reason === "refusal") throw new Error("Claude no quiso escribir los textos de este reporte.");
  if (response.stop_reason === "max_tokens") throw new Error("La respuesta de Claude quedó cortada.");
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("Claude no devolvió texto.");
  return JSON.parse(text.text) as ReportTexts;
}
