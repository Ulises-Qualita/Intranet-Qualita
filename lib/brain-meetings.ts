// Reuniones de los cerebros de área (Cerebros → <área> → Cargar información →
// Reunión). Solo server: se llama después de validar la sesión del equipo.
//
// El texto de una reunión sale de tres lados: un archivo (el export de Claude
// meetings en .md, una transcripción .vtt, un Word o PDF; el texto se saca en el
// navegador), texto pegado, o los documentos que Meet adjunta al evento del
// calendario (transcripción y notas de Gemini), que se leen de Drive como quien
// carga. Claude lo interpreta para el área y el equipo lo revisa antes de guardar.
import Anthropic from "@anthropic-ai/sdk";
import { addUsage, emptyTokens, recordUsage } from "./agent/usage";
import { aiChoice, effortParam } from "./ai-config";
import type { BrainArea } from "./brains";
import {
  type BrainMeeting,
  type CalendarDoc,
  type MeetingDraft,
  type MeetingInsights,
  type MeetingSource,
  type RecordedMeeting,
  MAX_TRANSCRIPT,
  parseInsights,
} from "./brain-meetings-shared";
import { attendeeName } from "./calendar";
import { GoogleAuthError, googleAccessToken, googleConfigured } from "./google";
import { createAdminClient } from "./supabase/server";

const TABLE = "intranet_brain_meetings";
// Los mismos scopes que ya tiene autorizados la delegación (lib/google.ts).
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const GOOGLE_DOC = "application/vnd.google-apps.document";
// Cuánto para atrás se buscan reuniones grabadas en el calendario.
export const RECORDED_DAYS = 60;

type Row = {
  id: string;
  area: string;
  source: MeetingSource;
  title: string;
  met_on: string | null;
  participants: unknown;
  file_name: string | null;
  drive_ids: string[] | null;
  transcript?: string;
  insights: unknown;
  created_at: string;
};

const COLUMNS = "id, area, source, title, met_on, participants, file_name, drive_ids, insights, created_at";

const toMeeting = (r: Row): BrainMeeting => ({
  id: r.id,
  area: r.area,
  source: r.source,
  title: r.title,
  metOn: r.met_on,
  participants: Array.isArray(r.participants) ? r.participants.filter((p): p is string => typeof p === "string") : [],
  fileName: r.file_name,
  insights: parseInsights(r.insights),
  createdAt: r.created_at,
});

export class BrainMeetingsError extends Error {}

// Sin la tabla (falta correr el SQL) devuelve null para que la pantalla avise.
export async function getBrainMeetings(area: string): Promise<BrainMeeting[] | null> {
  const { data, error } = await createAdminClient()
    .from(TABLE)
    .select(COLUMNS)
    .eq("area", area)
    .eq("status", "guardada")
    .order("met_on", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .returns<Row[]>();
  if (error) {
    if (error.code !== "PGRST205" && error.code !== "42P01") console.error("[cerebros] reuniones", error);
    return null;
  }
  return (data ?? []).map(toMeeting);
}

// ---------- Calendario y Drive ----------

async function tokenFor(email: string, scope: string) {
  try {
    return await googleAccessToken(email, scope);
  } catch (e) {
    if (e instanceof GoogleAuthError && e.code === "unauthorized_client") {
      throw new BrainMeetingsError("La cuenta de servicio de Google no tiene autorizada la delegación de dominio.");
    }
    throw new BrainMeetingsError(e instanceof Error ? e.message : "No se pudo autenticar con Google.");
  }
}

// Meet nombra sus documentos "… - Transcripción" y "… - Notas de Gemini" (o en inglés).
function docKind(title: string): CalendarDoc["kind"] {
  if (/transcri/i.test(title)) return "transcripcion";
  if (/gemini/i.test(title)) return "gemini";
  return "documento";
}

type RawEvent = {
  iCalUID?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  attendees?: { email?: string; displayName?: string; resource?: boolean }[];
  attachments?: { fileId?: string; title?: string; mimeType?: string }[];
  eventType?: string;
};

// Las reuniones pasadas del calendario de quien carga que tienen documentos de
// Google adjuntos (lo que deja Meet al grabar, transcribir o tomar notas con Gemini).
export async function getRecordedMeetings(email: string, area: string): Promise<RecordedMeeting[]> {
  if (!googleConfigured()) throw new BrainMeetingsError("Falta configurar la cuenta de servicio de Google.");
  const token = await tokenFor(email, CALENDAR_SCOPE);
  const now = Date.now();
  const events: RawEvent[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < 5; i++) {
    const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    url.search = new URLSearchParams({
      timeMin: new Date(now - RECORDED_DAYS * 86_400_000).toISOString(),
      timeMax: new Date(now).toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "2500",
      fields: "nextPageToken,items(iCalUID,summary,start,attendees(email,displayName,resource),attachments(fileId,title,mimeType),eventType)",
      ...(pageToken ? { pageToken } : {}),
    }).toString();
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) throw new BrainMeetingsError(body?.error?.message ?? `Google Calendar respondió ${res.status}`);
    events.push(...((body.items ?? []) as RawEvent[]));
    pageToken = body.nextPageToken;
    if (!pageToken) break;
  }

  const { data: loadedRows } = await createAdminClient()
    .from(TABLE)
    .select("drive_ids")
    .eq("area", area)
    .eq("status", "guardada")
    .returns<{ drive_ids: string[] | null }[]>();
  const loaded = new Set((loadedRows ?? []).flatMap((r) => r.drive_ids ?? []));

  const out: RecordedMeeting[] = [];
  for (const e of events) {
    const docs = (e.attachments ?? [])
      .filter((a) => a.fileId && a.mimeType === GOOGLE_DOC)
      .map((a) => ({ id: a.fileId!, title: a.title?.trim() || "Documento", kind: docKind(a.title ?? "") }));
    const start = e.start?.dateTime ?? e.start?.date;
    if (!docs.length || !start) continue;
    out.push({
      key: `${e.iCalUID ?? e.summary}|${start}`,
      title: e.summary?.trim() || "Sin título",
      start,
      attendees: (e.attendees ?? [])
        .filter((a) => a.email && !a.resource)
        .map((a) => attendeeName({ email: a.email!, name: a.displayName ?? null })),
      docs,
      loaded: docs.some((d) => loaded.has(d.id)),
    });
  }
  return out.reverse();
}

// El texto de los documentos elegidos, leídos de Drive como quien carga: solo
// abre lo que esa persona puede abrir.
export async function readMeetingDocs(email: string, docs: { id: string; title: string }[]) {
  const token = await tokenFor(email, DRIVE_SCOPE);
  const parts: string[] = [];
  for (const doc of docs) {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(doc.id)}/export?mimeType=text/plain`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      if (res.status === 404 || res.status === 403) {
        throw new BrainMeetingsError(`No tenés acceso a "${doc.title}" en Drive. Pedile al organizador de la reunión que te lo comparta.`);
      }
      throw new BrainMeetingsError(body?.error?.message ?? `Google Drive respondió ${res.status}`);
    }
    const text = (await res.text()).replace(/\r\n/g, "\n").trim();
    if (text) parts.push(`### ${doc.title}\n\n${text}`);
  }
  return parts.join("\n\n");
}

// ---------- Interpretación ----------

const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] };

export const INSIGHTS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "date", "participants", "learnings", "relevance", "relevanceNote"],
  properties: {
    title: { type: "string" },
    date: nullableString,
    participants: { type: "array", items: { type: "string" } },
    learnings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "detail"],
        properties: { title: { type: "string" }, detail: { type: "string" } },
      },
    },
    relevance: { type: "string", enum: ["alta", "media", "baja"] },
    relevanceNote: { type: "string" },
  },
};

// Solo se sacan criterios y aprendizajes del área (pedido: "lo que quiero
// extraer de las reuniones son los criterios y aprendizajes, sobre todo del área
// del cerebro; el resto no es necesario"). Título, fecha y participantes son
// para reconocer la reunión.
export function systemPrompt(area: BrainArea) {
  return `Sos parte de la intranet de Qualita Studio, una agencia argentina de branding, diseño y performance. El estudio arma un "cerebro" por área del equipo: el criterio de esa área, para después generar skills que trabajen como el equipo.

Vas a leer una reunión y sacar **solo los criterios y aprendizajes del área ${area.name}** (${area.description}). Puede venir como transcripción de Google Meet (lo que dijo cada uno), notas de Gemini o un resumen ya armado por otra herramienta, como el export de Claude meetings ("Action items", "Summary" y "Claude's notes" con Decisiones, Preguntas abiertas y Datos clave). En un resumen, los criterios suelen estar escondidos en las decisiones y los "Datos clave".

Hoy es ${new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" })}.

Devolvé, en español rioplatense neutro y profesional:
- learnings: lo único que importa. Criterios, formas de trabajar, reglas, estándares y aprendizajes de ${area.name} que sirvan más allá de esta reunión ("en cuentas chicas preferimos X porque Y", "un brief de web siempre tiene que traer Z", "la zona segura de historias pagas es más grande que la orgánica"). Cada uno:
  - title: de 3 a 7 palabras que nombran el criterio, sin punto final ("Zona segura en historias pagas", "Lista cerrada antes de explorar");
  - detail: la regla en una oración (dos como mucho, hasta ~35 palabras), con el porqué si se dijo; directa, sin relato de la reunión ni rodeos;
  - autocontenido: tiene que entenderse sin haber estado en la reunión;
  - si sale de un caso de un cliente puntual, nombrá el cliente como ejemplo.
  No van tareas, fechas, plazos puntuales, quién hace qué, estado de proyectos ni temas de otras áreas. Si la reunión no deja ningún criterio de ${area.name}, la lista va vacía.
- relevance: cuánto aporta la reunión al criterio de ${area.name} (alta, media o baja), y en relevanceNote, una oración que lo explique.
- title: un título corto (hasta 10 palabras) con el tema de la reunión. Si el texto trae el nombre del evento del calendario, usalo; un nombre genérico de exportación ("Meeting Notes - Nov 20", "Transcripción") no sirve como título.
- date: la fecha de la reunión (YYYY-MM-DD) si figura. Si viene sin año ("Nov 20"), es la más reciente que no sea posterior a hoy. Si no figura, null.
- participants: los nombres de quienes hablaron, figuran como participantes o tienen tareas asignadas (@Nombre → Nombre). No sumes a quien solo se menciona.

Reglas:
- Solo lo que está en el texto: no inventes criterios, datos ni conclusiones.
- No repitas el mismo criterio con otras palabras: juntalos en uno.
- Ignorá saludos, problemas de audio y charla que no aporta.`;
}

export type InterpretInput = {
  area: BrainArea;
  source: MeetingSource;
  text: string;
  // Lo que se sabe de antes (del evento del calendario o del nombre del archivo).
  title: string | null;
  date: string | null;
  participants: string[];
  fileName: string | null;
  driveIds: string[];
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const cut = (s: string, n: number) => s.trim().replace(/\s+/g, " ").slice(0, n);

// Claude interpreta la reunión y queda guardada como borrador hasta que el equipo
// la confirma (así el texto no viaja dos veces). Devuelve el borrador.
export async function interpretMeeting(input: InterpretInput, userId: string): Promise<MeetingDraft> {
  const text = input.text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_TRANSCRIPT);
  const ai = await aiChoice("cerebro");
  const known = [
    input.title && `Título del evento: ${input.title}`,
    input.date && `Fecha: ${input.date}`,
    input.participants.length && `Participantes según el calendario: ${input.participants.join(", ")}`,
    input.fileName && `Archivo: ${input.fileName}`,
  ]
    .filter(Boolean)
    .join("\n");

  const stream = new Anthropic().messages.stream({
    model: ai.model,
    max_tokens: 16000,
    system: systemPrompt(input.area),
    thinking: { type: "adaptive" },
    output_config: { ...effortParam(ai), format: { type: "json_schema", schema: INSIGHTS_SCHEMA } },
    messages: [
      {
        role: "user",
        content: `${known ? `${known}\n\n` : ""}<reunion>\n${text}\n</reunion>\n\nInterpretá esta reunión para el cerebro de ${input.area.name}.`,
      },
    ],
  });
  const response = await stream.finalMessage();
  await recordUsage("cerebro", userId, null, ai.model, addUsage(emptyTokens(), response.usage));

  if (response.stop_reason === "refusal") throw new BrainMeetingsError("Claude no quiso interpretar esta reunión.");
  if (response.stop_reason === "max_tokens") throw new BrainMeetingsError("La respuesta de Claude quedó cortada.");
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new BrainMeetingsError("Claude no devolvió la interpretación.");

  const raw = JSON.parse(block.text) as Record<string, unknown>;
  const insights: MeetingInsights = parseInsights(raw);
  const title = cut(input.title || (typeof raw.title === "string" ? raw.title : "") || input.fileName || "Reunión", 200);
  const date = input.date && ISO.test(input.date) ? input.date : typeof raw.date === "string" && ISO.test(raw.date) ? raw.date : null;
  const fromText = Array.isArray(raw.participants) ? raw.participants.filter((p): p is string => typeof p === "string") : [];
  const participants = [...new Set((input.participants.length ? input.participants : fromText).map((p) => cut(p, 80)).filter(Boolean))].slice(0, 40);

  const { data, error } = await createAdminClient()
    .from(TABLE)
    .insert({
      area: input.area.key,
      status: "borrador",
      source: input.source,
      title,
      met_on: date,
      participants,
      file_name: input.fileName ? cut(input.fileName, 200) : null,
      drive_ids: input.driveIds,
      transcript: text,
      insights,
      created_by: userId,
    })
    .select(COLUMNS)
    .single<Row>();
  if (error || !data) {
    if (error?.code === "PGRST205") throw new BrainMeetingsError("Falta correr docs/sql/2026-11-26-cerebros-reuniones.sql en Supabase.");
    // La fuente "notion" se sumó después al check de la columna source.
    if (error?.code === "23514" && input.source === "notion") {
      throw new BrainMeetingsError("Falta correr docs/sql/2026-11-27-cerebros-reuniones-notion.sql en Supabase.");
    }
    console.error("[cerebros] guardar borrador", error);
    throw new BrainMeetingsError("No se pudo guardar la reunión.");
  }
  return { ...toMeeting(data), words: text.split(/\s+/).length };
}
