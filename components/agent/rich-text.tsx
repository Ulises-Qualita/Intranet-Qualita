// Render del markdown acotado que escribe el agente: párrafos, listas, títulos,
// negrita y código. Sin librería: el prompt le pide justamente ese subconjunto,
// y una dependencia de markdown completo traería tablas y HTML crudo que en una
// burbuja de 380px no entran ni conviene renderizar.
import { Fragment } from "react";

// **negrita** y `código`, sin anidar. Se parte por los dos delimitadores a la vez
// para no tener que recorrer el texto dos veces.
function inline(text: string, key: string) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <b key={`${key}-${i}`}>{part.slice(2, -2)}</b>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return <code key={`${key}-${i}`}>{part.slice(1, -1)}</code>;
    }
    return <Fragment key={`${key}-${i}`}>{part}</Fragment>;
  });
}

type Block = { type: "p" | "h"; lines: string[] } | { type: "ul" | "ol"; lines: string[] };

// Agrupa las líneas en bloques. Las listas se cortan con la primera línea que no
// sea un ítem, así un párrafo pegado abajo no se come dentro de la lista.
function parse(markdown: string): Block[] {
  const blocks: Block[] = [];

  for (const raw of markdown.split("\n")) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    const last = blocks.at(-1);

    if (!line.trim()) {
      // Una línea en blanco cierra el bloque abierto.
      if (last) blocks.push({ type: "p", lines: [] });
      continue;
    }
    if (heading) {
      blocks.push({ type: "h", lines: [heading[1]] });
      continue;
    }
    if (bullet) {
      if (last?.type === "ul") last.lines.push(bullet[1]);
      else blocks.push({ type: "ul", lines: [bullet[1]] });
      continue;
    }
    if (numbered) {
      if (last?.type === "ol") last.lines.push(numbered[1]);
      else blocks.push({ type: "ol", lines: [numbered[1]] });
      continue;
    }
    if (last?.type === "p" && last.lines.length) last.lines.push(line);
    else blocks.push({ type: "p", lines: [line] });
  }

  return blocks.filter((b) => b.lines.length);
}

export function RichText({ children }: { children: string }) {
  return (
    <>
      {parse(children).map((block, i) => {
        if (block.type === "h") return <h4 key={i}>{inline(block.lines[0], `h${i}`)}</h4>;
        if (block.type === "p") return <p key={i}>{inline(block.lines.join(" "), `p${i}`)}</p>;
        const List = block.type === "ul" ? "ul" : "ol";
        return (
          <List key={i}>
            {block.lines.map((line, j) => (
              <li key={j}>{inline(line, `l${i}-${j}`)}</li>
            ))}
          </List>
        );
      })}
    </>
  );
}
