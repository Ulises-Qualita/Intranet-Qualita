import { type NextRequest } from "next/server";
import { getAreaSession } from "@/lib/auth";
import { BrainMeetingsError, interpretMeeting, readMeetingDocs } from "@/lib/brain-meetings";
import { MAX_TRANSCRIPT, MIN_TRANSCRIPT } from "@/lib/brain-meetings-shared";
import { brainArea } from "@/lib/brains";

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
    const source = body.source === "calendario" ? "calendario" : body.source === "archivo" ? "archivo" : "texto";
    if (source === "calendario") {
      const docs = (body.docs ?? [])
        .map((d) => ({ id: str(d?.id, 200), title: str(d?.title, 200) || "Documento" }))
        .filter((d) => /^[\w-]+$/.test(d.id))
        .slice(0, 5);
      if (!docs.length) return Response.json({ error: "Elegí al menos un documento de la reunión." }, { status: 400 });
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
        title: str(body.title, 200) || null,
        date: str(body.date, 10) || null,
        participants: Array.isArray(body.attendees) ? body.attendees.map((a) => str(a, 80)).filter(Boolean).slice(0, 40) : [],
        fileName: str(body.fileName, 200) || null,
        driveIds,
      },
      session.user.id,
    );
    return Response.json({ draft });
  } catch (e) {
    if (!(e instanceof BrainMeetingsError)) console.error("[cerebros] interpretar", area.key, e);
    return Response.json(
      { error: e instanceof BrainMeetingsError ? e.message : "Claude no pudo interpretar la reunión." },
      { status: 500 },
    );
  }
}
