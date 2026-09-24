// Herramientas del agente. Solo server.
//
// Cada tool es un envoltorio fino sobre lib/data.ts: no hay consultas nuevas a
// Supabase ni lógica de negocio duplicada. Todas leen con la sesión del usuario,
// así que la RLS vuelve a validar cada consulta.
//
// El candado de permisos es la LISTA de tools: se arma por request según las
// áreas del perfil. Si el usuario no tiene CRM, esas tools no existen en esa
// conversación — el modelo no puede llamarlas ni sabe que existen.
import type Anthropic from "@anthropic-ai/sdk";
import { canAccess, type AreaKey, type Profile } from "../auth-shared";
import {
  crmPeriod,
  getClients,
  getCrmSnapshot,
  getLeads,
  getMetaCampaigns,
  getMetaDaily,
  getTasks,
  getTeam,
  isLateTask,
  isOpenTask,
  leadFunnel,
  type Client,
} from "../data";
import { todayISO } from "../format";

// Una tool = su definición para la API + el área que la habilita + qué corre.
type AgentTool = {
  definition: Anthropic.Tool;
  area: AreaKey;
  run: (input: Record<string, unknown>) => Promise<unknown>;
};

// Redondeo para no gastar tokens en decimales que nadie va a leer.
const round = (value: number, decimals = 2) => Number(value.toFixed(decimals));
const div = (a: number, b: number) => (b ? round(a / b) : null);

const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const int = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback);

class ToolError extends Error {}

// El modelo escribe el cliente como lo nombró el usuario ("Disegno", "disegno
// milano"), no necesariamente como el slug. Se busca por slug, después por
// nombre, y si no hay match se le devuelve la lista para que reintente.
async function findClient(ref: unknown): Promise<Client> {
  const needle = str(ref);
  if (!needle) throw new ToolError("Falta el cliente.");

  const clients = await getClients();
  const key = needle.toLowerCase();
  const match =
    clients.find((c) => c.slug === key) ??
    clients.find((c) => c.name.toLowerCase() === key) ??
    clients.find((c) => c.name.toLowerCase().includes(key) || c.slug.includes(key));

  if (!match) {
    throw new ToolError(`No hay ningún cliente que se llame "${needle}". Los clientes activos son: ${clients.map((c) => c.name).join(", ")}.`);
  }
  return match;
}

// Una integración sin conectar no tiene datos que traer, y decirlo es una
// respuesta mejor que una lista vacía.
function requireIntegration(client: Client, provider: "meta" | "crm") {
  if (!client.conn[provider]) {
    throw new ToolError(`${client.name} no tiene ${provider === "meta" ? "Meta Ads" : "el CRM"} conectado, así que no hay datos para ese período.`);
  }
}

const CLIENTE_PROP = {
  cliente: { type: "string", description: "Nombre o slug del cliente." },
} as const;

const DIAS_PROP = {
  dias: { type: "number", description: "Días hacia atrás a considerar. Por defecto 30." },
} as const;

// ---------- Clientes ----------

const listarClientes: AgentTool = {
  area: "clientes",
  definition: {
    name: "listar_clientes",
    description:
      "Lista los clientes del estudio con su estado, rubro y qué integraciones tienen conectadas. Usala para saber qué clientes existen o cómo se escriben sus nombres antes de pedir datos de uno.",
    input_schema: {
      type: "object",
      properties: {
        incluir_inactivos: { type: "boolean", description: "Incluir también los clientes dados de baja. Por defecto false." },
      },
    },
  },
  run: async () => {
    const clients = await getClients();
    return clients.map((c) => ({
      nombre: c.name,
      slug: c.slug,
      estado: c.status,
      rubro: c.sector,
      web: c.website,
      conectado: Object.entries(c.conn)
        .filter(([, on]) => on)
        .map(([provider]) => provider),
    }));
  },
};

// ---------- Tareas ----------

const ESTADOS = { todo: "pendiente", doing: "en curso", blocked: "bloqueada", done: "completada" } as const;

const tareas: AgentTool = {
  area: "tareas",
  definition: {
    name: "tareas",
    description:
      "Tareas del estudio (tickets de Notion + tareas propias de la intranet), con su estado, prioridad, responsable y vencimiento. Son las de TODO el equipo, no solo las de quien pregunta: filtrá por responsable para ver las de una persona. Sin filtros devuelve las abiertas de todos los clientes. Además del listado devuelve un resumen con los totales por responsable, por cliente y por estado, calculado sobre todas las tareas que pasan el filtro: usá ese resumen para contar, no el listado, que viene recortado.",
    input_schema: {
      type: "object",
      properties: {
        ...CLIENTE_PROP,
        estado: { type: "string", enum: ["pendiente", "en curso", "bloqueada", "completada", "abiertas"], description: "Por defecto 'abiertas' (todo lo que no está completado)." },
        responsable: { type: "string", description: "Nombre o email del responsable." },
        vencidas: { type: "boolean", description: "Solo las que pasaron su fecha de vencimiento." },
        limite: { type: "number", description: "Máximo de tareas a devolver. Por defecto 40." },
      },
    },
  },
  run: async (input) => {
    const [all, clients, team] = await Promise.all([getTasks(), getClients(), getTeam().catch(() => [])]);
    const byId = new Map(clients.map((c) => [c.id, c.name]));
    const memberById = new Map(team.map((m) => [m.id, m.name]));

    let list = all;
    if (input.cliente) {
      const client = await findClient(input.cliente);
      list = list.filter((t) => t.client_id === client.id);
    }

    const estado = str(input.estado) ?? "abiertas";
    if (estado === "abiertas") list = list.filter(isOpenTask);
    else {
      const key = (Object.keys(ESTADOS) as (keyof typeof ESTADOS)[]).find((k) => ESTADOS[k] === estado);
      if (key) list = list.filter((t) => t.status === key);
    }

    const responsable = str(input.responsable)?.toLowerCase();
    if (responsable) {
      const matches = team.filter((m) => m.name.toLowerCase().includes(responsable) || m.email?.toLowerCase().includes(responsable));
      // Sin coincidencia, devolver una lista vacía haría que el agente afirme que
      // esa persona no tiene nada pendiente. Mejor decir que no existe y con quién
      // se lo pudo haber confundido.
      if (!matches.length) {
        throw new ToolError(
          team.length
            ? `No hay nadie en el equipo que se llame "${str(input.responsable)}". Los miembros son: ${team.map((m) => m.name).join(", ")}.`
            : "No se pudo leer la lista del equipo, así que no se puede filtrar por responsable.",
        );
      }
      const ids = new Set(matches.map((m) => m.id));
      list = list.filter((t) => t.assignee_id && ids.has(t.assignee_id));
    }

    const today = todayISO();
    if (input.vencidas === true) list = list.filter((t) => isLateTask(t, today));

    // Los totales se cuentan sobre todo lo filtrado, no sobre la página que se
    // devuelve: si no, "¿quién tiene más tareas?" contestaría sobre las primeras 40.
    const count = <T>(pick: (t: (typeof list)[number]) => T | null) => {
      const totals = new Map<T, number>();
      for (const task of list) {
        const key = pick(task);
        if (key !== null) totals.set(key, (totals.get(key) ?? 0) + 1);
      }
      return Object.fromEntries([...totals.entries()].sort((a, b) => b[1] - a[1]));
    };

    const sinResponsable = list.filter((t) => !t.assignee_id || !memberById.has(t.assignee_id)).length;
    const limite = int(input.limite, 40);
    return {
      total: list.length,
      mostrando: Math.min(list.length, limite),
      resumen: {
        por_responsable: {
          ...count((t) => (t.assignee_id ? (memberById.get(t.assignee_id) ?? null) : null)),
          ...(sinResponsable ? { "Sin responsable": sinResponsable } : {}),
        },
        por_cliente: count((t) => byId.get(t.client_id) ?? null),
        por_estado: count((t) => ESTADOS[t.status]),
        vencidas: list.filter((t) => isLateTask(t, today)).length,
      },
      tareas: list.slice(0, limite).map((t) => ({
        titulo: t.title,
        cliente: byId.get(t.client_id) ?? null,
        estado: ESTADOS[t.status],
        prioridad: t.priority,
        responsable: t.assignee_id ? (memberById.get(t.assignee_id) ?? null) : null,
        vence: t.due_date,
        vencida: isLateTask(t, today),
        origen: t.source,
      })),
    };
  },
};

// ---------- Meta ----------

const metaMetricas: AgentTool = {
  area: "meta",
  definition: {
    name: "meta_metricas",
    description:
      "Métricas diarias de Meta Ads de un cliente: alcance, impresiones, clics, gasto, leads, conversiones e ingresos. Devuelve los totales del período y la serie día por día.",
    input_schema: {
      type: "object",
      properties: { ...CLIENTE_PROP, ...DIAS_PROP },
      required: ["cliente"],
    },
  },
  run: async (input) => {
    const client = await findClient(input.cliente);
    requireIntegration(client, "meta");

    const dias = int(input.dias, 30);
    const daily = await getMetaDaily(client.id, dias);
    if (!daily.length) return { cliente: client.name, dias, aviso: "No hay métricas sincronizadas para ese período." };

    const sum = (pick: (d: (typeof daily)[number]) => number) => daily.reduce((total, d) => total + pick(d), 0);
    const spend = sum((d) => d.spend);
    const leads = sum((d) => d.leads);
    const impressions = sum((d) => d.impressions);
    const clicks = sum((d) => d.clicks);
    const revenue = sum((d) => d.revenue);
    const last = daily.at(-1)!;

    return {
      cliente: client.name,
      periodo: { desde: daily[0].date, hasta: last.date, dias: daily.length },
      totales: {
        gasto: round(spend),
        leads,
        cpl: div(spend, leads),
        impresiones: impressions,
        clics: clicks,
        ctr_pct: impressions ? round((clicks * 100) / impressions) : null,
        cpm: impressions ? round((spend * 1000) / impressions) : null,
        conversiones: sum((d) => d.conversions),
        ingresos: round(revenue),
        roas: div(revenue, spend),
        alcance_ultimo_dia: last.reach,
        seguidores_ultimo_dia: last.followers,
      },
      // El día a día sirve para responder por tendencias ("¿viene subiendo?").
      diario: daily.map((d) => ({
        fecha: d.date,
        alcance: d.reach,
        impresiones: d.impressions,
        clics: d.clicks,
        gasto: round(d.spend),
        leads: d.leads,
        interacciones: d.engagements,
      })),
    };
  },
};

const metaCampanas: AgentTool = {
  area: "meta",
  definition: {
    name: "meta_campanas",
    description:
      "Campañas y anuncios de Meta Ads de un cliente en el período, con gasto, leads, CPL, CTR e ingresos de cada uno. Usala para saber qué anuncio rinde mejor o peor.",
    input_schema: {
      type: "object",
      properties: { ...CLIENTE_PROP, ...DIAS_PROP },
      required: ["cliente"],
    },
  },
  run: async (input) => {
    const client = await findClient(input.cliente);
    requireIntegration(client, "meta");

    const dias = int(input.dias, 30);
    const campaigns = await getMetaCampaigns(client.id, dias);
    if (!campaigns.length) return { cliente: client.name, dias, aviso: "No hay anuncios sincronizados para ese período." };

    const metrics = (a: { spend: number; leads: number; clicks: number; impressions: number; revenue: number }) => ({
      gasto: round(a.spend),
      leads: a.leads,
      cpl: div(a.spend, a.leads),
      clics: a.clicks,
      impresiones: a.impressions,
      ctr_pct: a.impressions ? round((a.clicks * 100) / a.impressions) : null,
      ingresos: round(a.revenue),
      roas: div(a.revenue, a.spend),
    });

    return {
      cliente: client.name,
      dias,
      campanas: campaigns.map((c) => ({
        nombre: c.name,
        estado: c.status,
        ...metrics(c),
        anuncios: c.ads.map((a) => ({ nombre: a.name, estado: a.status, ...metrics(a) })),
      })),
    };
  },
};

// ---------- CRM ----------

const crmResumen: AgentTool = {
  area: "crm",
  definition: {
    name: "crm_resumen",
    description:
      "Estado del CRM de un cliente en el período: leads, conversión, ticket promedio, embudo por etapa, rendimiento por vendedor, por anuncio, por origen y por etiqueta.",
    input_schema: {
      type: "object",
      properties: { ...CLIENTE_PROP, ...DIAS_PROP },
      required: ["cliente"],
    },
  },
  run: async (input) => {
    const client = await findClient(input.cliente);
    requireIntegration(client, "crm");

    const dias = int(input.dias, 30);
    const [leads, snapshot] = await Promise.all([getLeads(client.id), getCrmSnapshot(client.id)]);
    if (!leads.length) return { cliente: client.name, dias, aviso: "No hay leads sincronizados." };

    const period = crmPeriod(leads, dias);
    return {
      cliente: client.name,
      dias,
      periodo: {
        leads: period.leads.length,
        ganadas: period.won,
        conversion_pct: period.conversion === null ? null : round(period.conversion, 1),
        ventas_con_ticket: period.tickets,
        ticket_promedio: period.ticketAvg === null ? null : round(period.ticketAvg),
        facturacion: round(period.ticketTotal),
        leads_desde_meta: period.fromMeta,
      },
      total_historico: { leads: leads.length, pipeline_abierto: snapshot ? round(snapshot.pipeline_value) : null, al: snapshot?.as_of ?? null },
      embudo: leadFunnel(period.leads).map((s) => ({ etapa: s.name, leads: s.value })),
      vendedores: period.sellers.map((s) => ({
        nombre: s.name,
        leads: s.leads,
        ganadas: s.won,
        ventas_con_ticket: s.tickets,
        ticket_promedio: s.ticketAvg === null ? null : round(s.ticketAvg),
        facturacion: round(s.ticketTotal),
      })),
      anuncios: period.ads.map((a) => ({ anuncio: a.name, leads: a.leads, ganadas: a.won, facturacion: round(a.ticketTotal) })),
      origenes: period.sources.map((s) => ({ origen: s.name, leads: s.leads, share_pct: round(s.share, 1) })),
      ventas_por_origen:
        period.wonSources?.map((s) => ({ origen: s.name, ganadas: s.leads, share_pct: round(s.share, 1), facturacion: round(s.ticketTotal) })) ?? null,
      // Una oportunidad puede tener varias etiquetas: las filas no suman el total.
      etiquetas:
        period.tags?.map((t) => ({ etiqueta: t.name, leads: t.leads, ganadas: t.won, facturacion: round(t.ticketTotal) })) ??
        TAGS_UNAVAILABLE,
    };
  },
};

// Sin la columna, "sin etiquetas" sería un dato falso: se avisa que no se sabe.
const TAGS_UNAVAILABLE =
  "Las etiquetas del CRM todavía no se están sincronizando (falta correr una migración en la base). No se sabe cuáles tiene cada oportunidad: no digas que no hay.";

const crmLeads: AgentTool = {
  area: "crm",
  definition: {
    name: "crm_leads",
    description: "Oportunidades concretas del CRM de un cliente, con etapa, estado, vendedor, anuncio de origen, etiquetas y monto. Usala cuando pregunten por leads puntuales, no por totales.",
    input_schema: {
      type: "object",
      properties: {
        ...CLIENTE_PROP,
        ...DIAS_PROP,
        estado: { type: "string", enum: ["abierta", "ganada", "perdida"], description: "Filtrar por estado de la oportunidad." },
        vendedor: { type: "string", description: "Nombre del vendedor a cargo." },
        etiqueta: { type: "string", description: "Etiqueta del CRM (coincidencia parcial, sin distinguir mayúsculas)." },
        limite: { type: "number", description: "Máximo de leads a devolver. Por defecto 30." },
      },
      required: ["cliente"],
    },
  },
  run: async (input) => {
    const client = await findClient(input.cliente);
    requireIntegration(client, "crm");

    const dias = int(input.dias, 30);
    const since = Date.now() - dias * 86_400_000;
    let list = (await getLeads(client.id)).filter((l) => Date.parse(l.created_at) >= since);

    const estado = str(input.estado);
    if (estado) {
      const key = { abierta: "open", ganada: "won", perdida: "lost" }[estado];
      list = list.filter((l) => l.status === key);
    }

    const vendedor = str(input.vendedor)?.toLowerCase();
    if (vendedor) list = list.filter((l) => l.owner?.toLowerCase().includes(vendedor));

    const etiqueta = str(input.etiqueta)?.toLowerCase();
    if (etiqueta && list.some((l) => l.tags === null)) return { cliente: client.name, aviso: TAGS_UNAVAILABLE };
    if (etiqueta) list = list.filter((l) => l.tags?.some((t) => t.toLowerCase().includes(etiqueta)));

    const limite = int(input.limite, 30);
    return {
      cliente: client.name,
      dias,
      total: list.length,
      mostrando: Math.min(list.length, limite),
      leads: list.slice(0, limite).map((l) => ({
        nombre: l.name,
        etapa: l.stage,
        estado: l.status,
        vendedor: l.owner,
        anuncio: l.ad,
        etiquetas: l.tags,
        origen: l.source,
        monto: l.amount,
        creada: l.created_at.slice(0, 10),
      })),
    };
  },
};

// ---------- Equipo ----------

const equipo: AgentTool = {
  area: "equipo",
  definition: {
    name: "equipo",
    description: "Miembros del equipo con su rol, áreas habilitadas, clientes asignados y cuántas tareas abiertas tiene cada uno.",
    input_schema: { type: "object", properties: {} },
  },
  run: async () => {
    const [team, clients, tasks] = await Promise.all([getTeam(), getClients(), getTasks().catch(() => [])]);
    const openByUser = new Map<string, number>();
    for (const t of tasks.filter(isOpenTask)) {
      if (t.assignee_id) openByUser.set(t.assignee_id, (openByUser.get(t.assignee_id) ?? 0) + 1);
    }

    return team.map((m) => ({
      nombre: m.name,
      email: m.email,
      rol: m.role,
      activo: m.active,
      invitado_sin_ingresar: m.invited,
      areas: Object.entries(m.areas ?? {})
        .filter(([, on]) => on)
        .map(([area]) => area),
      clientes: clients.filter((c) => c.assigneeIds.includes(m.id)).map((c) => c.name),
      tareas_abiertas: openByUser.get(m.id) ?? 0,
    }));
  },
};

const ALL_TOOLS = [listarClientes, tareas, metaMetricas, metaCampanas, crmResumen, crmLeads, equipo];

// Las tools que este usuario puede usar. Es el control de acceso del agente: lo
// que no está acá no existe para el modelo.
export function toolsFor(profile: Profile | null) {
  const allowed = ALL_TOOLS.filter((t) => canAccess(profile, t.area));
  return {
    definitions: allowed.map((t) => t.definition),
    async run(name: string, input: unknown): Promise<string> {
      const tool = allowed.find((t) => t.definition.name === name);
      // Sin la tool en la lista el modelo no debería llamarla; si igual pasa, se
      // le responde como error en vez de ejecutar nada.
      if (!tool) return JSON.stringify({ error: `La herramienta "${name}" no está disponible para este usuario.` });

      try {
        return JSON.stringify(await tool.run((input ?? {}) as Record<string, unknown>));
      } catch (e) {
        if (e instanceof ToolError) return JSON.stringify({ error: e.message });
        console.error("[agente] tool", name, e);
        return JSON.stringify({ error: "No se pudo leer ese dato de la intranet." });
      }
    },
  };
}
