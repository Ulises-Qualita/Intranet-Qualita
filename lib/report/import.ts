// Reportes cargados a mano: Claude lee el PDF o HTML de un reporte hecho fuera
// de la intranet y saca sus números (lib/report/metrics.ts) para poder
// compararlo. Solo server. El equipo revisa lo que devuelve antes de guardarlo.
import Anthropic from "@anthropic-ai/sdk";
import { addUsage, emptyTokens, recordUsage } from "../agent/usage";
import { aiChoice, effortParam } from "../ai-config";
import { emptyMetrics, METRICS_SCHEMA, parseMetrics, type ReportMetrics } from "./metrics";

const SYSTEM = `Leés reportes de performance de Qualita Studio (agencia de branding y performance de Argentina) y extraés sus números a un JSON con esquema fijo.

Reglas:
- Copiá solo números que estén escritos en el reporte. Si un dato no figura, devolvé null: nunca lo calcules, estimes ni completes.
- Excepción: si el reporte trae la base y no la tasa (o al revés), dejá la que no figura en null; no la derives.
- Montos en pesos argentinos como número sin símbolo ni separadores ("$ 3.166.555" → 3166555). Si un monto está en dólares, va solo en usdBilled.
- Porcentajes como número de 0 a 100 ("5,51%" → 5.51). Tiempos de respuesta en horas ("10,3h" → 10.3). Tiempo activo en segundos ("34s" → 34). Cantidades abreviadas como en el texto ("4,4K" → 4400).
- Ignorá las comparaciones con otros meses ("▲ 5% vs Septiembre"): solo interesan los valores del período del reporte.
- pauta: totales de Meta + Google Ads. Los "leads" de Google son sus conversiones. metaSpend/gadsSpend y metaLeads/gadsLeads solo si el reporte los separa.
- campaigns: la tabla de leads por campaña, con su plataforma (meta o google).
- crm: oportunidades captadas (opportunities), abiertas (open), perdidas o descartadas (lost), ventas confirmadas (won), oportunidades de la primera y la segunda mitad del período (firstHalf, lastHalf), mediana de respuesta (responseMedianHours), % contactados en 24 h (contacted24Pct), cuántos tardaron más de 3 días (over3Days), oportunidades por canal (sources) y vendedores (sellers: ventas, leads, facturación y ticket promedio).
- sales: facturación de las ventas (billed), ventas (won), ventas con ticket (withTicket), ticket promedio (ticketAvg) y ventas por origen (bySource).
- clarity: usuarios, sesiones, sesiones por día, páginas por sesión, tiempo activo, scroll, % de sesiones con clics de frustración (rageShare), % mobile (mobileShare) y origen del tráfico en % (sources).
- Una sección que el reporte no tiene va en null; una lista sin filas, vacía.
- since/until: el período que cubre el reporte (YYYY-MM-DD), si figura.`;

// HTML sin lo que no aporta números: imágenes embebidas, estilos y scripts.
function cleanHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, "")
    .replace(/\s+/g, " ");
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export type ExtractedReport = { since: string | null; until: string | null; metrics: ReportMetrics };

export async function extractReportMetrics(
  file: { bytes: Buffer; type: "application/pdf" | "text/html" },
  clientName: string,
  userId: string,
): Promise<ExtractedReport> {
  const ai = await aiChoice("reporte");
  const client = new Anthropic();
  const source: Anthropic.ContentBlockParam =
    file.type === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: file.bytes.toString("base64") } }
      : { type: "text", text: `HTML del reporte:\n\n${cleanHtml(file.bytes.toString("utf8"))}` };

  const stream = client.messages.stream({
    model: ai.model,
    max_tokens: 32000,
    system: SYSTEM,
    thinking: { type: "adaptive" },
    output_config: { ...effortParam(ai), format: { type: "json_schema", schema: METRICS_SCHEMA } },
    messages: [
      {
        role: "user",
        content: [source, { type: "text", text: `Reporte del cliente ${clientName}. Extraé sus números.` }],
      },
    ],
  });
  const response = await stream.finalMessage();
  await recordUsage("reporte", userId, null, ai.model, addUsage(emptyTokens(), response.usage));

  if (response.stop_reason === "refusal") throw new Error("Claude no quiso leer este reporte.");
  if (response.stop_reason === "max_tokens") throw new Error("La respuesta de Claude quedó cortada.");
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("Claude no devolvió los números.");

  const raw = JSON.parse(text.text) as { since?: unknown; until?: unknown };
  const date = (v: unknown) => (typeof v === "string" && ISO.test(v) ? v : null);
  return { since: date(raw.since), until: date(raw.until), metrics: parseMetrics(raw) ?? emptyMetrics() };
}
