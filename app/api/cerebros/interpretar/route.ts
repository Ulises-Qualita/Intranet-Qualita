import { type NextRequest } from "next/server";
import { getAreaSession } from "@/lib/auth";
import { BrainMeetingsError, interpretMeeting, readMeetingDocs } from "@/lib/brain-meetings";
import { MAX_TRANSCRIPT, MIN_TRANSCRIPT, notionRef } from "@/lib/brain-meetings-shared";
import { BrainNotionError, readNotionMeeting } from "@/lib/brain-notion";
import { brainArea } from "@/lib/brains";
import { NotionError, notionErrorMessage } from "@/lib/notion";

// Día (YYYY-MM-DD) en Buenos Aires de una fecha de Notion, con o sin hora.
const dayOf = (iso: string) =>
  iso.length === 10 ? iso : new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });

// Una reunión larga tarda en interpretarse.
export const maxDuration = 300;

type Body = {
  area?: string;
  source?: string;
  // archivo / texto: el texto ya sacado en el navegador.
  text?: string;
  fileName?: string | null;
  // calendario: los documentos de Meet adjuntos al evento.
  docs?: { id?: string; title?: string }[];
  title?: string | null;
  date?: string | null;
  attendees?: string[];
  // notion: la página de la database de Reuniones.
  pageId?: string;
};

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// Claude interpreta una reunión para un cerebro de área y la deja como borrador
// (lib/brain-meetings.ts). Guardarla o descartarla lo hacen las acciones de
// cerebros/actions.ts cuando el equipo revisa.
export async function POST(request: NextRequest) {
  const session = await getAreaSession("clientes");
  if (!session?.profile?.active) return Response.json({ error: "Sin acceso." }, { status: 403 });

  const body = (await request.json().catch(() => null)) as Body | null;
  const area = brainArea(body?.area ?? "");
  if (!body || !area) return Response.json({ error: "Área no encontrada." }, { status: 404 });

  try {
    let text = "";
    let driveIds: string[] = [];
    const source =
      body.source === "calendario" || body.source === "archivo" || body.source === "notion" ? body.source : "texto";
    let title = str(body.title, 200) || null;
    let date = str(body.date, 10) || null;
    let participants = Array.isArray(body.attendees) ? body.attendees.map((a) => str(a, 80)).filter(Boolean).slice(0, 40) : [];
    if (source === "notion") {
      // El texto se lee acá de Notion (validando que la página sea de Reuniones),
      // y el título, la fecha y los participantes salen de sus propiedades.
      const read = await readNotionMeeting(str(body.pageId, 64));
      text = read.text;
      driveIds = [notionRef(read.page.id)];
      title = read.page.title;
      date = read.page.date ? dayOf(read.page.date) : null;
      participants = read.page.participants.slice(0, 40);
    } else if (source === "calendario") {
      const docs = (body.docs ?? [])
        .map((d) => ({ id: str(d?.id, 200), title: str(d?.title, 200) || "Documento" }))
        .filter((d) => /^[\w-]+$/.test(d.id))
        // Un documento por reunión (pedido: se elige la reunión, no sus documentos):
        // la pantalla manda la transcripción o, si no hay, las notas de Gemini.
        .slice(0, 1);
      if (!docs.length) return Response.json({ error: "La reunión no tiene documentos para leer." }, { status: 400 });
      text = await readMeetingDocs(session.user.email, docs);
      driveIds = docs.map((d) => d.id);
    } else {
      text = typeof body.text === "string" ? body.text : "";
    }
    if (text.trim().length < MIN_TRANSCRIPT) {
      return Response.json({ error: "El texto es muy corto para ser una reunión." }, { status: 400 });
    }
    if (text.length > MAX_TRANSCRIPT * 1.5) {
      return Response.json({ error: "El texto es demasiado largo. Cargá una reunión por vez." }, { status: 400 });
    }

    const draft = await interpretMeeting(
      {
        area,
        source,
        text,
        title,
        date,
        participants,
        fileName: str(body.fileName, 200) || null,
        driveIds,
      },
      session.user.id,
    );
    return Response.json({ draft });
  } catch (e) {
    const known = e instanceof BrainMeetingsError || e instanceof BrainNotionError;
    if (!known) console.error("[cerebros] interpretar", area.key, e);
    return Response.json(
      {
        error: known
          ? (e as Error).message
          : e instanceof NotionError
            ? notionErrorMessage(e)
            : "Claude no pudo interpretar la reunión.",
      },
      { status: 500 },
    );
  }
}
