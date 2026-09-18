"use client";

import { useState, useTransition } from "react";
import type { NotionDataSource, NotionProperty } from "@/lib/notion";
import {
  EMPTY_NOTION_CONFIG,
  PROP_ROLES,
  guessPriorityMap,
  guessProps,
  guessStatusMap,
  propertyOptions,
  type NotionConfig,
  type NotionProps,
} from "@/lib/notion-map";
import type { TaskPriority, TaskStatus } from "@/lib/tasks";
import { loadNotionProperties, saveNotionConfig } from "../actions";

const STATUS_LABELS: { value: TaskStatus; label: string }[] = [
  { value: "todo", label: "Pendientes" },
  { value: "doing", label: "En curso" },
  { value: "blocked", label: "Bloqueadas" },
  { value: "done", label: "Completadas" },
];

// Valor del select para "este estado no es trabajo del equipo". No es un
// TaskStatus: se guarda aparte, en hiddenStatuses.
const HIDDEN = "hidden";

const PRIORITY_LABELS: { value: TaskPriority; label: string }[] = [
  { value: "alta", label: "Alta" },
  { value: "media", label: "Media" },
  { value: "baja", label: "Baja" },
];

export function NotionSetup({
  sources,
  config,
  initialProperties,
  initialProjectProperties,
}: {
  sources: NotionDataSource[];
  config: NotionConfig | null;
  // Schemas de las databases ya configuradas, leídos en el server para no pagar
  // un viaje extra al abrir la pantalla.
  initialProperties: NotionProperty[];
  initialProjectProperties: NotionProperty[];
}) {
  const [projectsId, setProjectsId] = useState(config?.projectsDataSourceId ?? "");
  const [ticketsId, setTicketsId] = useState(config?.ticketsDataSourceId ?? "");
  const [props, setProps] = useState<NotionProps>(config?.props ?? EMPTY_NOTION_CONFIG.props);
  const [statusMap, setStatusMap] = useState<Record<string, TaskStatus>>(config?.statusMap ?? {});
  const [priorityMap, setPriorityMap] = useState<Record<string, TaskPriority>>(config?.priorityMap ?? {});
  const [hiddenStatuses, setHiddenStatuses] = useState<string[]>(config?.hiddenStatuses ?? []);

  // Portal del cliente: qué propiedad url de Proyectos guarda el link al portal.
  const [portalUrlProp, setPortalUrlProp] = useState(config?.portalUrlProp ?? "");
  const [projectProperties, setProjectProperties] = useState<NotionProperty[]>(initialProjectProperties);
  const [loadingProject, setLoadingProject] = useState(false);

  const [properties, setProperties] = useState<NotionProperty[]>(initialProperties);
  const [loadingProps, setLoadingProps] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  // Elegir la database de Tickets dispara la lectura de su schema. Si vuelve a ser
  // la que ya estaba guardada se respeta ese mapeo; si es otra, se pre-carga por
  // heurística sobre las propiedades reales.
  function chooseTickets(nextId: string) {
    setTicketsId(nextId);
    setError(null);
    if (!nextId) {
      setProperties([]);
      return;
    }

    setLoadingProps(true);
    startTransition(async () => {
      const result = await loadNotionProperties(nextId);
      setLoadingProps(false);
      if (!result.ok) {
        setProperties([]);
        setError(result.error);
        return;
      }
      setProperties(result.properties);

      const isSaved = nextId === config?.ticketsDataSourceId;
      const nextProps = isSaved && config ? config.props : guessProps(result.properties);
      setProps(nextProps);
      setStatusMap(isSaved && config ? config.statusMap : guessStatusMap(result.properties, nextProps.status));
      setPriorityMap(isSaved && config ? config.priorityMap : guessPriorityMap(result.properties, nextProps.priority));
      setHiddenStatuses(isSaved && config ? (config.hiddenStatuses ?? []) : []);
    });
  }

  // Elegir la database de Proyectos lee su schema para poder ofrecer sus
  // propiedades de tipo url (de ahí sale el link al portal de cada cliente).
  function chooseProjects(nextId: string) {
    setProjectsId(nextId);
    setError(null);
    if (!nextId) {
      setProjectProperties([]);
      setPortalUrlProp("");
      return;
    }

    setLoadingProject(true);
    startTransition(async () => {
      const result = await loadNotionProperties(nextId);
      setLoadingProject(false);
      if (!result.ok) {
        setProjectProperties([]);
        setError(result.error);
        return;
      }
      setProjectProperties(result.properties);

      if (nextId === config?.projectsDataSourceId && config.portalUrlProp) {
        setPortalUrlProp(config.portalUrlProp);
        return;
      }
      // Pre-selección: la propiedad url que hable de portal.
      const urls = result.properties.filter((p) => p.type === "url");
      setPortalUrlProp((urls.find((p) => /portal/i.test(p.name)) ?? urls[0])?.name ?? "");
    });
  }

  const urlProps = projectProperties.filter((p) => p.type === "url");

  // Cambiar la propiedad de Estado o Prioridad invalida el mapeo de sus opciones.
  function setRole(key: keyof NotionProps, value: string) {
    setProps((p) => ({ ...p, [key]: value }));
    if (key === "status") {
      setStatusMap(guessStatusMap(properties, value));
      setHiddenStatuses([]);
    }
    if (key === "priority") setPriorityMap(guessPriorityMap(properties, value));
  }

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await saveNotionConfig({
        projectsDataSourceId: projectsId,
        ticketsDataSourceId: ticketsId,
        props,
        statusMap,
        priorityMap,
        // Solo las opciones que siguen existiendo en la database elegida.
        hiddenStatuses: hiddenStatuses.filter((s) => statusOptions.includes(s)),
        portalUrlProp,
      });
      if (result.ok) setSaved(true);
      else setError(result.error);
    });
  }

  const statusOptions = propertyOptions(properties, props.status);
  const priorityOptions = propertyOptions(properties, props.priority);

  return (
    <form
      className="stack-form"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label>
        <span>Database de Proyectos</span>
        <select value={projectsId} onChange={(e) => chooseProjects(e.target.value)} disabled={pending}>
          <option value="">Elegir…</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span>Database de Tickets</span>
        <select value={ticketsId} onChange={(e) => chooseTickets(e.target.value)} disabled={pending}>
          <option value="">Elegir…</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      {loadingProps && <p className="muted">Leyendo las propiedades de la database…</p>}

      {properties.length > 0 && (
        <>
          <fieldset className="notion-props" disabled={pending}>
            <legend>Qué propiedad de Tickets es cada cosa</legend>
            {PROP_ROLES.map((role) => {
              const candidates = properties.filter((p) => role.types.includes(p.type));
              return (
                <label key={role.key}>
                  <span>
                    {role.label}
                    {role.key === "project" && <b> *</b>}
                  </span>
                  <select value={props[role.key]} onChange={(e) => setRole(role.key, e.target.value)}>
                    <option value="">{candidates.length ? "Sin usar" : `Sin propiedades de tipo ${role.types.join("/")}`}</option>
                    {candidates.map((p) => (
                      <option key={p.id} value={p.name}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </fieldset>
          <p className="muted">
            Solo <b>Proyecto</b> es obligatorio: es lo que dice a qué cliente pertenece cada ticket. Sin las demás, el
            ticket igual se muestra (pendiente, prioridad media, sin responsable ni vencimiento).
          </p>

          {statusOptions.length > 0 && (
            <fieldset className="notion-map" disabled={pending}>
              <legend>En qué columna cae cada estado</legend>
              {statusOptions.map((option) => (
                <label key={option}>
                  <span>{option}</span>
                  <select
                    value={hiddenStatuses.includes(option) ? HIDDEN : (statusMap[option] ?? "todo")}
                    onChange={(e) => {
                      const value = e.target.value;
                      setHiddenStatuses((h) => (value === HIDDEN ? [...h, option] : h.filter((s) => s !== option)));
                      if (value !== HIDDEN) setStatusMap((m) => ({ ...m, [option]: value as TaskStatus }));
                    }}
                  >
                    {STATUS_LABELS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                    <option value={HIDDEN}>No mostrar</option>
                  </select>
                </label>
              ))}
            </fieldset>
          )}

          {statusOptions.length > 0 && (
            <p className="muted">
              <b>No mostrar</b> deja el estado afuera de la intranet: los tickets que estén ahí no aparecen en el
              tablero de Tareas ni cuentan como pendientes. Es para lo que no es trabajo del equipo, como las reuniones.
            </p>
          )}

          {priorityOptions.length > 0 && (
            <fieldset className="notion-map" disabled={pending}>
              <legend>Cómo se traduce cada prioridad</legend>
              {priorityOptions.map((option) => (
                <label key={option}>
                  <span>{option}</span>
                  <select
                    value={priorityMap[option] ?? "media"}
                    onChange={(e) => setPriorityMap((m) => ({ ...m, [option]: e.target.value as TaskPriority }))}
                  >
                    {PRIORITY_LABELS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </fieldset>
          )}
        </>
      )}

      <hr className="form-sep" />

      {loadingProject && <p className="muted">Leyendo las propiedades de Proyectos…</p>}

      <label>
        <span>Portal del cliente</span>
        <select value={portalUrlProp} onChange={(e) => setPortalUrlProp(e.target.value)} disabled={pending || !urlProps.length}>
          <option value="">{urlProps.length ? "Sin usar" : "Proyectos no tiene propiedades de tipo URL"}</option>
          {urlProps.map((p) => (
            <option key={p.id} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <p className="muted">
        Propiedad de <b>Proyectos</b> donde está el link a la página del portal. La intranet la lee y muestra su
        contenido en la solapa Portal de cada cliente. Es opcional: sin esto el resto funciona igual.
      </p>

      {error && <p className="form-error">{error}</p>}
      {saved && !error && <p className="form-ok">Configuración guardada. Ya podés vincular el proyecto de cada cliente.</p>}

      <div className="form-actions">
        <button type="submit" className="btn-primary" disabled={pending || loadingProps || !ticketsId || !props.project}>
          {pending ? "Guardando…" : "Guardar configuración"}
        </button>
      </div>
    </form>
  );
}
