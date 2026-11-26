import type { IconName } from "@/components/icons";

// Cerebros internos de Qualita (solapa Cerebros del panel interno): uno por área
// del equipo. Cada uno junta el contexto y el criterio del área (documentos,
// notas y, más adelante, grabaciones de reuniones) para después generar skills.
// Por ahora es solo la interfaz: todavía no hay tablas ni carga real.
//
// Los cerebros de cada cliente son otra cosa (otra sección, otras fuentes) y no
// salen de esta lista.

export type BrainArea = {
  key: string;
  name: string;
  // Una línea: de qué se ocupa el cerebro de esa área.
  description: string;
  icon: IconName;
  // Qué tipo de material le sirve, para orientar a quien carga.
  feeds: string[];
};

export const BRAIN_AREAS: BrainArea[] = [
  {
    key: "redes",
    name: "Redes Sociales",
    description: "Cómo pensamos el contenido, los formatos y la comunidad.",
    icon: "social",
    feeds: ["Guías de contenido", "Calendarios", "Análisis de cuentas"],
  },
  {
    key: "seo",
    name: "SEO",
    description: "Criterios de posicionamiento, auditorías y palabras clave.",
    icon: "search",
    feeds: ["Auditorías", "Checklists técnicos", "Estrategias de keywords"],
  },
  {
    key: "web",
    name: "Web",
    description: "Cómo diseñamos, desarrollamos y medimos sitios.",
    icon: "globe",
    feeds: ["Procesos de desarrollo", "Briefs de sitios", "Buenas prácticas"],
  },
  {
    key: "pauta",
    name: "Pauta",
    description: "Criterio de campañas en Meta y Google Ads.",
    icon: "target",
    feeds: ["Criterios de pauta", "Estructuras de campaña", "Reportes"],
  },
  {
    key: "branding",
    name: "Branding",
    description: "Proceso de marca, identidad y manuales.",
    icon: "pen",
    feeds: ["Manuales de marca", "Metodología", "Presentaciones"],
  },
  {
    key: "estrategia",
    name: "Estrategia",
    description: "Diagnósticos, planes y la mirada de negocio del estudio.",
    icon: "compass",
    feeds: ["Diagnósticos", "Planes anuales", "Propuestas"],
  },
];

export const brainArea = (key: string) => BRAIN_AREAS.find((a) => a.key === key) ?? null;

// Formatos que se van a poder cargar a mano.
export const BRAIN_ACCEPT = ".pdf,.md,.txt,.docx,.doc,.csv,.pptx";
