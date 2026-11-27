// La skill descargable de un cerebro de área (Cerebros → <área> → Skill). Solo
// server: se llama después de validar la sesión del equipo.
//
// Claude arma un SKILL.md (formato de Agent Skills: frontmatter con name y
// description, y el cuerpo en markdown) con todos los criterios y aprendizajes
// guardados del área. Cada versión queda en intranet_brain_skills
// (docs/sql/2026-11-26-cerebros-skills.sql) y se descarga en el navegador.
import Anthropic from "@anthropic-ai/sdk";
import { addUsage, emptyTokens, recordUsage } from "./agent/usage";
import { aiChoice, effortParam } from "./ai-config";
import { getBrainMeetings } from "./brain-meetings";
import { type BrainSkill, MIN_SKILL_CRITERIA, criterionKey, skillName } from "./brain-skills-shared";
import type { BrainArea } from "./brains";
import { createAdminClient } from "./supabase/server";

const TABLE = "intranet_brain_skills";
const COLUMNS = "id, area, version, name, content, criteria_count, meetings_count, criteria_keys, created_at";
type Row = {
  id: string;
  area: string;
  version: number;
  name: string;
  content: string;
  criteria_count: number;
  meetings_count: number;
  criteria_keys: string[] | null;
  created_at: string;
};

export class BrainSkillError extends Error {}

const toSkill = (r: Row): BrainSkill => ({
  id: r.id,
  area: r.area,
  version: r.version,
  name: r.name,
  content: r.content,
  criteriaCount: r.criteria_count,
  meetingsCount: r.meetings_count,
  criteriaKeys: r.criteria_keys ?? [],
  createdAt: r.created_at,
});

// La última versión del área; null si no hay o si falta la tabla (undefined).
export async function getBrainSkill(area: string): Promise<BrainSkill | null | undefined> {
  const { data, error } = await createAdminClient()
    .from(TABLE)
    .select(COLUMNS)
    .eq("area", area)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle<Row>();
  if (error) {
    if (error.code !== "PGRST205" && error.code !== "42P01") console.error("[cerebros] skill", error);
    return undefined;
  }
  return data ? toSkill(data) : null;
}

function systemPrompt(area: BrainArea, name: string) {
  return `Escribís una skill de Claude (Agent Skills) para el equipo de Qualita Studio, una agencia de branding, diseño y performance de Argentina. La skill le da a Claude el criterio de Qualita en el área de ${area.name} (${area.description.toLowerCase()}), para que trabaje como lo haría alguien del estudio.

Recibís los criterios y aprendizajes que el equipo fue guardando de sus reuniones, cada uno con su fecha. Devolvé SOLO el contenido del archivo SKILL.md, sin texto antes ni después y sin envolverlo en un bloque de código.

Formato:
- Arranca con el frontmatter YAML entre líneas "---", con dos campos:
  - name: ${name}
  - description: en tercera persona, hasta 900 caracteres, qué hace la skill y cuándo usarla, con las situaciones y palabras concretas que la deberían activar (tareas típicas de ${area.name.toLowerCase()} para clientes de Qualita). Entre comillas dobles.
- Después, el cuerpo en markdown, en español rioplatense, claro y directo:
  1. "# Criterio de Qualita: ${area.name}" y un párrafo corto de para qué sirve.
  2. "## Cómo trabajamos": los criterios agrupados por tema, con un "###" por tema. Cada criterio como regla accionable en imperativo y, en la misma viñeta, el porqué en pocas palabras.
  3. "## Antes de entregar": un checklist corto (casillas "- [ ]") que sale de esos criterios.
  4. "## Cuando hay dudas": 2 a 4 líneas sobre cómo decidir lo que los criterios no cubren, con el espíritu que se desprende de ellos.

Reglas:
- Usá solo lo que dicen los criterios: no inventes reglas, números, herramientas ni procesos. Podés agruparlos, juntar los repetidos y redactarlos mejor.
- Si dos criterios se contradicen, quedate con el más reciente.
- Sin nombres de personas, clientes ni reuniones: es criterio general del estudio.
- Hasta unas 300 líneas.`;
}

// Genera una versión nueva con los criterios guardados del área y la guarda.
export async function generateBrainSkill(area: BrainArea, userId: string): Promise<BrainSkill> {
  const meetings = await getBrainMeetings(area.key);
  if (meetings === null) throw new BrainSkillError("Falta correr docs/sql/2026-11-26-cerebros-reuniones.sql en Supabase.");
  const criteria = meetings.flatMap((m) => m.insights.learnings.map((l) => ({ ...l, date: m.metOn })));
  if (criteria.length < MIN_SKILL_CRITERIA) {
    throw new BrainSkillError(`Hacen falta al menos ${MIN_SKILL_CRITERIA} criterios para armar la skill. Cargá más reuniones.`);
  }
  const name = skillName(area.key);
  const list = criteria
    .map((c, i) => `${i + 1}. ${c.date ? `[${c.date}] ` : ""}${c.title ? `${c.title}: ` : ""}${c.detail}`)
    .join("\n");

  const ai = await aiChoice("cerebro");
  const stream = new Anthropic().messages.stream({
    model: ai.model,
    max_tokens: 20000,
    system: systemPrompt(area, name),
    thinking: { type: "adaptive" },
    ...(ai.effort ? { output_config: effortParam(ai) } : {}),
    messages: [{ role: "user", content: `<criterios area="${area.name}">\n${list}\n</criterios>\n\nEscribí el SKILL.md.` }],
  });
  const response = await stream.finalMessage();
  await recordUsage("cerebro", userId, null, ai.model, addUsage(emptyTokens(), response.usage));
  if (response.stop_reason === "refusal") throw new BrainSkillError("Claude no quiso armar la skill.");
  if (response.stop_reason === "max_tokens") throw new BrainSkillError("La respuesta de Claude quedó cortada.");
  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim()
    .replace(/^```(?:markdown|md)?\n([\s\S]*)\n```$/, "$1")
    .trim();
  if (!/^---\n[\s\S]*?\bname:[\s\S]*?\bdescription:[\s\S]*?\n---\n/.test(text.replace(/\r\n/g, "\n"))) {
    throw new BrainSkillError("Claude no devolvió una skill con el formato esperado. Probá de nuevo.");
  }

  const db = createAdminClient();
  const { data: last } = await db.from(TABLE).select("version").eq("area", area.key).order("version", { ascending: false }).limit(1).maybeSingle<{ version: number }>();
  const { data, error } = await db
    .from(TABLE)
    .insert({
      area: area.key,
      version: (last?.version ?? 0) + 1,
      name,
      content: text,
      criteria_count: criteria.length,
      meetings_count: meetings.length,
      criteria_keys: [...new Set(criteria.map(criterionKey))],
      created_by: userId,
    })
    .select(COLUMNS)
    .single<Row>();
  if (error || !data) {
    if (error?.code === "PGRST205") throw new BrainSkillError("Falta correr docs/sql/2026-11-26-cerebros-skills.sql en Supabase.");
    console.error("[cerebros] guardar skill", error);
    throw new BrainSkillError("No se pudo guardar la skill.");
  }
  return toSkill(data);
}
