// Skill de un cerebro de área: tipos y constantes sin imports de server (los usa
// también el navegador para descargarla). Ver lib/brain-skills.ts.

export type BrainSkill = {
  id: string;
  area: string;
  version: number;
  // Nombre de la skill y de su carpeta en el .zip (qualita-redes…).
  name: string;
  // El SKILL.md entero (frontmatter + cuerpo).
  content: string;
  criteriaCount: number;
  meetingsCount: number;
  // Huella de cada criterio con que se armó (criterionKey).
  criteriaKeys: string[];
  createdAt: string;
};

// Con menos criterios la skill no tiene de dónde salir.
export const MIN_SKILL_CRITERIA = 3;

// Huella corta de un criterio (FNV-1a de su texto normalizado): sirve para saber
// cuáles son nuevos y cuáles se borraron desde una versión de la skill. Editar
// un criterio cuenta como uno nuevo y uno borrado.
export function criterionKey(c: { title: string; detail: string }) {
  const text = `${c.title}|${c.detail}`.toLowerCase().replace(/\s+/g, " ").trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export const skillName = (areaKey: string) => `qualita-${areaKey}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 64);
