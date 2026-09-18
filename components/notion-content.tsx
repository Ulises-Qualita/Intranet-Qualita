import {
  WEEKDAYS,
  buildCalendar,
  groupBlocks,
  plainOf,
  type BlockNode,
  type DbCell,
  type EmbeddedDb,
  type RichText,
} from "@/lib/notion-blocks";
import { longDate, todayISO } from "@/lib/format";

// Render de una página de Notion con la tipografía y los colores de la intranet.
// Todo va scopeado a .notion-doc para no chocar con las clases del mockup.

function Text({ parts }: { parts?: RichText[] }) {
  if (!parts?.length) return null;
  return (
    <>
      {parts.map((p, i) => {
        let node: React.ReactNode = p.text;
        if (p.code) node = <code key={i}>{node}</code>;
        if (p.bold) node = <strong>{node}</strong>;
        if (p.italic) node = <em>{node}</em>;
        if (p.underline) node = <u>{node}</u>;
        if (p.strike) node = <s>{node}</s>;
        if (p.href) {
          node = (
            <a href={p.href} target="_blank" rel="noreferrer">
              {node}
            </a>
          );
        }
        return <span key={i}>{node}</span>;
      })}
    </>
  );
}

function Caption({ parts }: { parts?: RichText[] }) {
  if (!parts?.length) return null;
  return (
    <figcaption>
      <Text parts={parts} />
    </figcaption>
  );
}

// Celda de una database embebida: las opciones van como chips y las fechas en
// formato es-AR, como el resto de la intranet.
function Cell({ cell }: { cell: DbCell }) {
  switch (cell.kind) {
    case "tags":
      if (!cell.tags.length) return <span className="muted">—</span>;
      return (
        <span className="nd-tags">
          {cell.tags.map((t) => (
            <span key={t.name} className={`nd-tag c-${t.color}`}>
              {t.name}
            </span>
          ))}
        </span>
      );
    case "date":
      return cell.text ? <>{longDate(cell.text)}</> : <span className="muted">—</span>;
    case "check":
      return <>{cell.checked ? "Sí" : "No"}</>;
    default:
      return cell.text ? <>{cell.text}</> : <span className="muted">—</span>;
  }
}

// Database con fecha → calendario mensual, como la vista de Notion. Solo se
// dibujan los meses que tienen algo: un roadmap de 3 meses no muestra 12.
function Calendar({ db }: { db: EmbeddedDb }) {
  const { months, undated } = buildCalendar(db, todayISO());

  return (
    <div className="nd-cal">
      {months.map((month) => (
        <div key={month.key} className="nd-cal-month">
          <div className="nd-cal-title">{month.label}</div>
          <div className="nd-cal-grid">
            {WEEKDAYS.map((d) => (
              <div key={d} className="nd-cal-wd">
                {d}
              </div>
            ))}
            {month.weeks.flat().map((day) => (
              <div key={day.iso} className={`nd-cal-day${day.inMonth ? "" : " out"}${day.isToday ? " today" : ""}`}>
                <span className="nd-cal-num">{day.day}</span>
                {day.events.map((e) => (
                  <span key={e.id} className={`nd-ev c-${e.color}`} title={e.title}>
                    {e.title}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}

      {undated.length > 0 && (
        <div className="nd-cal-undated">
          <b>Sin fecha</b>
          {undated.map((e) => (
            <span key={e.id} className={`nd-ev c-${e.color}`}>
              {e.title}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Block({ node }: { node: BlockNode }) {
  const children = node.children?.length ? <Blocks nodes={node.children} /> : null;

  switch (node.type) {
    case "paragraph":
      // Notion usa párrafos vacíos como separación; no aportan nada al render.
      if (!node.text?.length) return children;
      return (
        <p>
          <Text parts={node.text} />
          {children}
        </p>
      );

    case "heading_1":
      return (
        <h2>
          <Text parts={node.text} />
        </h2>
      );
    case "heading_2":
      return (
        <h3>
          <Text parts={node.text} />
        </h3>
      );
    case "heading_3":
      return (
        <h4>
          <Text parts={node.text} />
        </h4>
      );

    case "to_do":
      return (
        <div className={`nd-todo${node.checked ? " done" : ""}`}>
          <span className="nd-check" aria-hidden>
            {node.checked ? "✓" : ""}
          </span>
          <div>
            <Text parts={node.text} />
            {children}
          </div>
        </div>
      );

    case "toggle":
      return (
        <details className="nd-toggle">
          <summary>
            <Text parts={node.text} />
          </summary>
          {children}
        </details>
      );

    case "quote":
      return (
        <blockquote>
          <Text parts={node.text} />
          {children}
        </blockquote>
      );

    case "callout":
      return (
        <div className="nd-callout">
          {node.icon && (
            <span className="nd-callout-ico" aria-hidden>
              {node.icon}
            </span>
          )}
          <div>
            <Text parts={node.text} />
            {children}
          </div>
        </div>
      );

    case "code":
      return (
        <pre className="nd-code">
          <code>{plainOf(node.text)}</code>
        </pre>
      );

    case "divider":
      return <hr />;

    case "image":
      if (!node.url) return null;
      return (
        <figure className="nd-figure">
          {/* Las URLs de archivo de Notion vienen firmadas y vencen, así que no
              pasan por next/image (que las cachearía con la firma adentro). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={node.url} alt={plainOf(node.caption) || ""} loading="lazy" />
          <Caption parts={node.caption} />
        </figure>
      );

    case "video":
      if (!node.url) return null;
      return (
        <figure className="nd-figure">
          <video src={node.url} controls preload="metadata" />
          <Caption parts={node.caption} />
        </figure>
      );

    case "file":
      if (!node.url) return null;
      return (
        <p>
          <a href={node.url} target="_blank" rel="noreferrer">
            {plainOf(node.caption) || "Descargar archivo"}
          </a>
        </p>
      );

    case "bookmark":
    case "embed":
      if (!node.url) return null;
      return (
        <p className="nd-bookmark">
          <a href={node.url} target="_blank" rel="noreferrer">
            {plainOf(node.caption) || node.url}
          </a>
        </p>
      );

    case "column_list":
      return <div className="nd-cols">{children}</div>;
    case "column":
      return <div className="nd-col">{children}</div>;

    case "table":
      return (
        <div className="nd-table-wrap">
          <table className="nd-table">
            <tbody>
              {(node.children ?? []).map((row, i) => (
                <tr key={row.id}>
                  {(row.cells ?? []).map((cell, j) =>
                    node.hasHeaderRow && i === 0 ? (
                      <th key={j}>
                        <Text parts={cell} />
                      </th>
                    ) : (
                      <td key={j}>
                        <Text parts={cell} />
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    // Las filas las dibuja la tabla; sueltas no significan nada.
    case "table_row":
      return null;

    case "child_page":
      return (
        <p className="nd-childpage">
          <Text parts={node.text} />
        </p>
      );

    // Database embebida (el roadmap del portal). Sin db resuelta es una vista
    // enlazada: Notion no expone a qué database apunta.
    case "child_database":
      return (
        <div className="nd-db">
          <h3>
            <Text parts={node.text} />
          </h3>
          {!node.db ? (
            <p className="nd-unsupported">
              Es una vista enlazada de Notion. La API no puede leerla; embebé la database directamente en la página.
            </p>
          ) : node.db.rows.length === 0 ? (
            <p className="nd-unsupported">Todavía no tiene filas.</p>
          ) : node.db.dateColumn !== null ? (
            <Calendar db={node.db} />
          ) : (
            <div className="nd-table-wrap">
              <table className="nd-table">
                <thead>
                  <tr>
                    {node.db.columns.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {node.db.rows.map((row) => (
                    <tr key={row.id}>
                      {row.cells.map((cell, i) => (
                        <td key={i}>
                          <Cell cell={cell} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      );

    // Un bloque sin soporte no se descarta en silencio: en una vista interna es
    // preferible que el equipo vea que falta algo a que el portal mienta por omisión.
    case "unsupported":
      return <p className="nd-unsupported">Bloque de Notion sin soporte todavía: {node.rawType}</p>;

    default:
      return null;
  }
}

export function Blocks({ nodes }: { nodes: BlockNode[] }) {
  // Notion entrega los ítems de lista planos: hay que juntarlos para armar ul/ol.
  return (
    <>
      {groupBlocks(nodes).map((group, i) => {
        if (group.kind === "block") return <Block key={group.node.id} node={group.node} />;
        const List = group.type === "numbered_list_item" ? "ol" : "ul";
        return (
          <List key={`${group.type}-${i}`}>
            {group.items.map((item) => (
              <li key={item.id}>
                <Text parts={item.text} />
                {item.children?.length ? <Blocks nodes={item.children} /> : null}
              </li>
            ))}
          </List>
        );
      })}
    </>
  );
}

export function NotionContent({ blocks }: { blocks: BlockNode[] }) {
  return (
    <div className="notion-doc">
      <Blocks nodes={blocks} />
    </div>
  );
}
