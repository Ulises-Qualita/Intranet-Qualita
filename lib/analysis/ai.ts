// "Analizar plataforma": Claude revisa la cuenta publicitaria y devuelve una
// lectura general, lo que funciona y recomendaciones accionables con su lugar
// exacto (campaña, conjunto o anuncio). Solo server: usa ANTHROPIC_API_KEY.
//
// Recibe solo el contexto ya armado (lib/analysis/meta-data.ts) y responde JSON
// con un esquema fijo (structured outputs).
import Anthropic from "@anthropic-ai/sdk";
import { addUsage, emptyTokens, recordUsage } from "../agent/usage";
import { aiChoice } from "../ai-config";
import { PRIORITIES, EFFORTS, CATEGORIES, TARGET_LEVELS, type AnalysisResult } from "./shared";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "strengths", "recommendations"],
  properties: {
    summary: {
      type: "string",
      description: "Lectura general de la cuenta en el período: 3 a 5 oraciones, con los números que la sostienen.",
    },
    strengths: {
      type: "array",
      description: "Entre 1 y 4 cosas que están funcionando y conviene mantener, una oración cada una.",
      items: { type: "string" },
    },
    recommendations: {
      type: "array",
      description: "Entre 4 y 10 recomendaciones, de la de más impacto a la de menos.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["priority", "effort", "category", "title", "targetLevel", "targetName", "action", "reason", "impact"],
        properties: {
          priority: { type: "string", enum: PRIORITIES },
          effort: { type: "string", enum: EFFORTS, description: "Cuánto trabajo lleva hacerla." },
          category: { type: "string", enum: CATEGORIES },
          title: { type: "string", description: "Hasta 8 palabras, en imperativo." },
          targetLevel: { type: "string", enum: TARGET_LEVELS },
          targetName: {
            type: "string",
            description: 'Nombre exacto, copiado tal cual del contexto, de la campaña, conjunto o anuncio. "" si targetLevel es "cuenta".',
          },
          action: {
            type: "string",
            description:
              'Qué hacer, concreto y en segunda persona, como se lo dirías a un paid media: "Te recomiendo…". Con valores cuando corresponda (cuánto subir o bajar, qué edad excluir, cuántas creatividades sumar).',
          },
          reason: { type: "string", description: "Por qué: los números del contexto que lo justifican, en 1 o 2 oraciones." },
          impact: { type: "string", description: "Qué se espera que mejore, en una oración. Sin prometer cifras que no salgan de los datos." },
        },
      },
    },
  },
} as const;

const SYSTEM = `Sos especialista senior en paid media en Qualita Studio, una agencia de branding y performance de Argentina. Revisás la cuenta publicitaria de un cliente para el equipo de paid media de la agencia (no para el cliente): querés que mejoren la pauta y, sobre todo, las ventas.

Recibís en JSON la configuración real de la cuenta (campañas, conjuntos con su segmentación y presupuesto, anuncios con su creatividad), el rendimiento del período y del anterior, la evolución por semana de cada campaña, cortes por edad/sexo, ubicación y dispositivo, y a veces las ventas del CRM atribuidas a cada anuncio.

Cómo trabajar:
- Basate solo en el contexto. No inventes datos ni causas; si algo es una hipótesis, decilo ("puede deberse a…") y proponé cómo comprobarlo.
- Priorizá lo que mueve ventas y costo: presupuesto mal repartido, conjuntos en aprendizaje limitado, frecuencia alta con CTR en baja (desgaste), segmentos que gastan sin resultados, ubicaciones caras, campañas que compiten entre sí, objetivos u optimizaciones que no coinciden con lo que se busca, creatividades flojas o sin variantes.
- Si hay datos de CRM, pesan más que el CPL: un anuncio con leads baratos y cero ventas no es el mejor. Ojo: un anuncio sin datos de CRM no prueba que no vendió.
- Cada recomendación apunta a un lugar concreto (targetLevel + targetName copiado tal cual) y dice qué hacer con valores ("bajá el presupuesto diario de $20.000 a $14.000 y pasá la diferencia a…"). Nada genérico tipo "probá más creatividades" sin decir dónde y por qué.
- Si una cuenta tiene poco gasto o pocos días, decilo en la lectura y sé prudente: menos recomendaciones y más de estructura y medición.
- Si el contexto trae "analisisAnterior", revisá qué se recomendó y su estado: no repitas lo que ya se hizo; si algo se marcó hecho, mirá si los números cambiaron; si se descartó, no insistas salvo que haya un dato nuevo.
- Español rioplatense (voseo), directo, sin relleno. Números en formato argentino ($1.234.567, 12,5%). Sin markdown salvo **negrita** puntual.`;

// El razonamiento no se muestra (salía en inglés y no aportaba): el modal solo
// enseña los pasos, así que no se pide el resumen y no se transmite.
export async function analyzeWithClaude(
  context: Record<string, unknown>,
  userId: string,
): Promise<{ result: AnalysisResult; model: string }> {
  const ai = await aiChoice("analisis");
  const client = new Anthropic();
  const stream = client.messages.stream({
    model: ai.model,
    max_tokens: 32000,
    system: SYSTEM,
    thinking: { type: "adaptive" },
    // Sin esfuerzo elegido en /admin/gastos, alto: es un análisis, no un chat.
    output_config: { effort: ai.effort ?? "high", format: { type: "json_schema", schema: SCHEMA } },
    messages: [
      {
        role: "user",
        content: `Contexto de la cuenta (JSON):\n${JSON.stringify(context)}\n\nAnalizá la cuenta y devolvé la lectura, lo que funciona y las recomendaciones.`,
      },
    ],
  });
  const response = await stream.finalMessage();

  await recordUsage("analisis", userId, null, ai.model, addUsage(emptyTokens(), response.usage));

  if (response.stop_reason === "refusal") throw new Error("Claude no quiso analizar esta cuenta.");
  if (response.stop_reason === "max_tokens") throw new Error("La respuesta de Claude quedó cortada.");
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("Claude no devolvió texto.");
  return { result: JSON.parse(text.text) as AnalysisResult, model: ai.model };
}
