// Reuniones de los cerebros de área: tipos y límites que comparten el server y
// la pantalla. Sin imports de server.

export type MeetingSource = "calendario" | "archivo" | "texto";

// Lo que Claude saca de una reunión para el cerebro de un área: solo los
// criterios y aprendizajes de esa área (pedido del usuario).
// Un criterio: un título corto que lo nombra y una o dos oraciones con la regla
// y el porqué (para mostrarlo en bullets, no como bloque de texto).
export type Learning = { title: string; detail: string };

export type MeetingInsights = {
  learnings: Learning[];
  // Cuánto aporta al criterio del área (una reunión puede tocarla de costado).
  relevance: "alta" | "media" | "baja";
  relevanceNote: string;
};

export type BrainMeeting = {
  id: string;
  area: string;
  source: MeetingSource;
  title: string;
  metOn: string | null;
  participants: string[];
  fileName: string | null;
  insights: MeetingInsights;
  createdAt: string;
};

// Borrador recién interpretado, para revisar antes de guardar.
export type MeetingDraft = BrainMeeting & { words: number };

// Una reunión del calendario propio con documentos de Meet (transcripción o
// notas de Gemini) adjuntos.
export type CalendarDoc = { id: string; title: string; kind: "transcripcion" | "gemini" | "documento" };
export type RecordedMeeting = {
  key: string;
  title: string;
  start: string;
  attendees: string[];
  docs: CalendarDoc[];
  // Ya cargada en esta área (comparte algún documento con una guardada).
  loaded: boolean;
};

// Archivos que se pueden subir: el texto se saca en el navegador.
export const MEETING_ACCEPT = ".md,.txt,.vtt,.srt,.docx,.pdf";
export const MAX_MEETING_FILE = 20 * 1024 * 1024;
// Tope del texto que se manda a Claude y se guarda (~100k tokens): una reunión
// de varias horas entra de sobra.
export const MAX_TRANSCRIPT = 400_000;
export const MIN_TRANSCRIPT = 200;

export const SOURCE_LABEL: Record<MeetingSource, string> = {
  calendario: "Meet",
  archivo: "Archivo",
  texto: "Texto pegado",
};

export const RELEVANCE_LABEL: Record<MeetingInsights["relevance"], string> = {
  alta: "Muy relacionada",
  media: "Relacionada en parte",
  baja: "Poco relacionada",
};

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

// Lo guardado (o lo que devuelve Claude) se vuelve a validar al leerlo.
export function parseInsights(v: unknown): MeetingInsights {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const rel = o.relevance === "alta" || o.relevance === "media" || o.relevance === "baja" ? o.relevance : "media";
  return {
    learnings: (Array.isArray(o.learnings) ? o.learnings : [])
      // Las primeras reuniones guardaron cada criterio como un texto suelto.
      .map((l) => (typeof l === "string" ? { title: "", detail: str(l) } : { title: str(l?.title), detail: str(l?.detail) }))
      .filter((l) => l.title || l.detail),
    relevance: rel,
    relevanceNote: str(o.relevanceNote),
  };
}
