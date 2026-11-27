// Texto de un archivo de reunión, sacado en el navegador (así al server solo
// viaja el texto, sin subir el archivo). Markdown y texto tal cual; .vtt / .srt
// sin las marcas de tiempo; Word con mammoth; PDF con pdf.js.

const ext = (name: string) => name.toLowerCase().split(".").pop() ?? "";

// "00:01:02.000 --> 00:01:05.000", números de cue y el encabezado WEBVTT afuera.
function stripCaptions(text: string) {
  return text
    .split(/\r?\n/)
    .filter((line) => !/^WEBVTT/.test(line) && !/-->/.test(line) && !/^\d+$/.test(line.trim()) && !/^NOTE\b/.test(line))
    .map((line) => line.replace(/<\/?v[^>]*>/g, "").trim())
    .filter(Boolean)
    .join("\n");
}

async function pdfText(file: File) {
  const lib = await import("pdfjs-dist");
  lib.GlobalWorkerOptions.workerPort ??= new Worker(new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url), { type: "module" });
  const task = lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : " ") : "")).join(""));
  }
  await task.destroy();
  return pages.join("\n\n");
}

export async function meetingFileText(file: File): Promise<string> {
  const kind = ext(file.name);
  if (kind === "md" || kind === "txt") return file.text();
  if (kind === "vtt" || kind === "srt") return stripCaptions(await file.text());
  if (kind === "docx") {
    const mammoth = await import("mammoth");
    return (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
  }
  if (kind === "pdf") return pdfText(file);
  throw new Error("Ese tipo de archivo no se puede leer. Usá .md, .txt, .vtt, .docx o .pdf.");
}
