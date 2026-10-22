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
  getSales,
  getTasks,
  getTeam,
  isLateTask,
  isOpenTask,
  leadFunnel,
  saleDay,
  salesPeriod,
  withMetaAdNames,
  type Client,
} from "../data";
import { chatStats, duration, getChatEvents, getChatStart, getStageEvents, replyTurns, stageEntries, turnStats, WORK_HOURS, type ReplyTurn } from "../crm-chats";
import { getCrmSecrets } from "../crm-sync";
import { localDate, todayISO } from "../format";
import { customPeriod, lastDays, monthPeriod, type Period } from "../period";
import { SHOW_TASKS } from "../tasks";

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

// El período se pide igual que en las vistas de la intranet: un mes calendario
// (lo que la gente dice: "octubre"), un rango de fechas o los últimos N días.
// Sin nada, el mes actual, que es lo que muestran las solapas al entrar.
const PERIODO_PROP = {
  mes: { type: "string", description: "Mes calendario YYYY-MM (p. ej. 2026-10 para octubre). Si es el mes actual, va del 1 a hoy. Usalo cuando nombren un mes." },
  desde: { type: "string", description: "Inicio de un rango YYYY-MM-DD, incluido. Va con `hasta`." },
  hasta: { type: "string", description: "Fin de un rango YYYY-MM-DD, incluido. Va con `desde`." },
  dias: { type: "number", description: "Últimos N días hasta hoy. Solo si lo piden así." },
} as const;

const ISO_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function periodFrom(input: Record<string, unknown>): Period {
  const desde = str(input.desde);
  const hasta = str(input.hasta);
  if (desde && hasta && ISO_DATE.test(desde) && ISO_DATE.test(hasta)) return customPeriod(desde, hasta);
  const mes = str(input.mes);
  if (mes && ISO_MONTH.test(mes) && mes <= todayISO().slice(0, 7)) return monthPeriod(mes);
  const dias = int(input.dias, 0);
  if (dias > 0 && dias <= 366) return lastDays(dias);
  return monthPeriod(todayISO().slice(0, 7));
}

// Cómo se informa el período en cada respuesta, para que el modelo diga cuál es.
const periodOut = (p: Period) => ({ desde: p.since, hasta: p.until, nombre: p.label });

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
      properties: { ...CLIENTE_PROP, ...PERIODO_PROP },
      required: ["cliente"],
    },
  },
  run: async (input) => {
    const client = await findClient(input.cliente);
    requireIntegration(client, "meta");

    const period = periodFrom(input);
    const daily = await getMetaDaily(client.id, period);
    if (!daily.length) return { cliente: client.name, periodo: periodOut(period), aviso: "No hay métricas sincronizadas para ese período." };

    const sum = (pick: (d: (typeof daily)[number]) => number) => daily.reduce((total, d) => total + pick(d), 0);
    const spend = sum((d) => d.spend);
    const leads = sum((d) => d.leads);
    const impressions = sum((d) => d.impressions);
    const clicks = sum((d) => d.clicks);
    const revenue = sum((d) => d.revenue);
    const last = daily.at(-1)!;

    return {
      cliente: client.name,
      periodo: { ...periodOut(period), primer_dia_con_datos: daily[0].date, ultimo_dia_con_datos: last.date },
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
      properties: { ...CLIENTE_PROP, ...PERIODO_PROP },
      required: ["cliente"],
    },
  },
  run: async (input) => {
    const client = await findClient(input.cliente);
    requireIntegration(client, "meta");

    const period = periodFrom(input);
    const campaigns = await getMetaCampaigns(client.id, period);
    if (!campaigns.length) return { cliente: client.name, periodo: periodOut(period), aviso: "No hay anuncios sincronizados para ese período." };

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
      periodo: periodOut(period),
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
      "Estado del CRM de un cliente en el período: leads, conversión, ticket promedio, embudo por etapa, rendimiento por vendedor, por anuncio, por origen y por etiqueta. Si el cliente registra las ventas en una planilla, trae además `ventas_planilla`: la facturación oficial, por fecha de confirmación, en pesos y en dólares por separado (no se convierten).",
    input_schema: {
      type: "object",
      properties: { ...CLIENTE_PROP, ...PERIODO_PROP },
      required: ["cliente"],
    },
  },
  run: async (input) => {
    const client = await findClient(input.cliente);
    requireIntegration(client, "crm");

    const range = periodFrom(input);
    const [leads, snapshot, secrets] = await Promise.all([getLeads(client.id), getCrmSnapshot(client.id), getCrmSecrets(client.id)]);
    if (!leads.length) return { cliente: client.name, periodo: periodOut(range), aviso: "No hay leads sincronizados." };

    const period = crmPeriod(leads, range);
    // Con planilla, la venta y la facturación oficiales salen de ahí.
    const allSales = secrets?.sales_sheet ? await getSales(client.id) : null;
    const sheet = allSales && salesPeriod(allSales, leads, range);
    // El CRM puede guardar el anuncio con un nombre corto: se pasa al de Meta (solo
    // los nombres; si no se pueden leer, quedan los del CRM).
    const campaigns = client.conn.meta ? await getMetaCampaigns(client.id, range).catch(() => null) : null;
    const ads = campaigns ? withMetaAdNames(period.ads, campaigns.flatMap((c) => c.ads)) : period.ads;
    return {
      cliente: client.name,
      periodo: periodOut(range),
      criterio: CRM_CRITERIO,
      totales: {
        oportunidades_creadas: period.leads.length,
        ganadas: period.won,
        conversion_pct: period.conversion === null ? null : round(period.conversion, 1),
        ventas_con_ticket: period.tickets,
        ticket_promedio: period.ticketAvg === null ? null : round(period.ticketAvg),
        facturacion: round(period.ticketTotal),
        leads_desde_meta: period.fromMeta,
      },
      ventas_planilla: sheet
        ? {
            nota: "Fuente oficial de ventas. Cuenta por fecha de confirmación del proyecto. En los cortes por lead (ganadas, facturación, vendedores y anuncios de arriba), ganada = tiene venta en la planilla y el monto es el de esa venta en pesos; las oportunidades van por fecha de creación del lead y las ventas por fecha de venta (con planilla, la de confirmación).",
            ventas: sheet.sales.length,
            facturacion_pesos: round(sheet.ars.total),
            ticket_promedio_pesos: sheet.ars.avg === null ? null : round(sheet.ars.avg),
            facturacion_dolares: round(sheet.usd.total),
            ticket_promedio_dolares: sheet.usd.avg === null ? null : round(sheet.usd.avg),
            sin_oportunidad_en_crm: sheet.unattributed,
            vendedores: sheet.sellers.map((s) => ({
              nombre: s.name,
              ventas: s.sales,
              facturacion_pesos: round(s.ars.total),
              facturacion_dolares: round(s.usd.total),
            })),
            por_origen: sheet.sources.map((s) => ({ origen: s.name, ventas: s.sales, pesos: round(s.ars), dolares: round(s.usd) })),
          }
        : null,
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
      anuncios: ads.map((a) => ({
        anuncio: a.name,
        leads: a.leads,
        ganadas: a.won,
        facturacion: round(a.ticketTotal),
        ...(a.usdTotal ? { facturacion_dolares: round(a.usdTotal) } : {}),
      })),
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

// Mismo criterio que la solapa CRM (crmPeriod): se repite en cada resultado para
// que el modelo no mezcle las dos fechas.
const CRM_CRITERIO =
  "Oportunidades (oportunidades_creadas, embudo, orígenes, conversión) = creadas en el período. Ganadas, ventas con ticket, facturación y ventas por vendedor, anuncio, origen o etiqueta = pasaron a ganada en el período, sin importar cuándo se creó la oportunidad. Es el mismo criterio de la solapa CRM.";

// Sin la columna, "sin etiquetas" sería un dato falso: se avisa que no se sabe.
const TAGS_UNAVAILABLE =
  "Las etiquetas del CRM todavía no se están sincronizando (falta correr una migración en la base). No se sabe cuáles tiene cada oportunidad: no digas que no hay.";

// Cada lead son ~60 tokens que se reenvían en cada vuelta del loop, y un listado
// de cientos no entra en una respuesta de chat: los recuentos salen de crm_resumen.
const MAX_LEADS = 50;

const crmLeads: AgentTool = {
  area: "crm",
  definition: {
    name: "crm_leads",
    description:
      "Oportunidades concretas del CRM de un cliente, con etapa, estado, vendedor, anuncio de origen, etiquetas, monto, fecha de creación y, si se ganó, fecha en que pasó a ganada. Con estado \"ganada\" trae las que pasaron a ganada en el período (las ventas del período, aunque se hayan creado antes): son las mismas que cuenta crm_resumen y la solapa CRM. Sin estado o con otro estado, filtra por fecha de creación. Devuelve como máximo 50: para totales, conversión o cortes por vendedor, etapa, anuncio, origen o etiqueta usá crm_resumen.",
    input_schema: {
      type: "object",
      properties: {
        ...CLIENTE_PROP,
        ...PERIODO_PROP,
        estado: { type: "string", enum: ["abierta", "ganada", "perdida"], description: "Filtrar por estado de la oportunidad." },
        vendedor: { type: "string", description: "Nombre del vendedor a cargo." },
        etiqueta: { type: "string", description: "Etiqueta del CRM (coincidencia parcial, sin distinguir mayúsculas)." },
        limite: { type: "number", description: "Máximo de leads a devolver. Por defecto 30, tope 50." },
      },
      required: ["cliente"],
    },
  },
  run: async (input) => {
    const client = await findClient(input.cliente);
    requireIntegration(client, "crm");

    const range = periodFrom(input);
    const inRange = (day: string) => day >= range.since && day <= range.until;
    const leads = await getLeads(client.id);

    // Las ganadas van por fecha de venta, como en crmPeriod: una oportunidad de
    // agosto ganada en octubre es venta de octubre. Lo demás, por creación.
    const estado = str(input.estado);
    let list =
      estado === "ganada"
        ? leads.filter((l) => l.status === "won" && inRange(saleDay(l))).sort((a, b) => saleDay(b).localeCompare(saleDay(a)))
        : leads.filter((l) => inRange(localDate(l.created_at)));
    if (estado && estado !== "ganada") {
      const key = { abierta: "open", perdida: "lost" }[estado];
      list = list.filter((l) => l.status === key);
    }

    const vendedor = str(input.vendedor)?.toLowerCase();
    if (vendedor) list = list.filter((l) => l.owner?.toLowerCase().includes(vendedor));

    const etiqueta = str(input.etiqueta)?.toLowerCase();
    if (etiqueta && list.some((l) => l.tags === null)) return { cliente: client.name, aviso: TAGS_UNAVAILABLE };
    if (etiqueta) list = list.filter((l) => l.tags?.some((t) => t.toLowerCase().includes(etiqueta)));

    const limite = Math.min(Math.max(int(input.limite, 30), 1), MAX_LEADS);
    return {
      cliente: client.name,
      periodo: periodOut(range),
      filtro_fecha: estado === "ganada" ? "fecha en que pasó a ganada" : "fecha de creación",
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
        creada: localDate(l.created_at),
        ...(l.status === "won" ? { ganada_el: saleDay(l) } : {}),
      })),
    };
  },
};

// Atención por chat (solo Kommo): primera respuesta a los leads nuevos, como la
// solapa CRM, y tiempo de respuesta en cada vuelta de la conversación, por etapa,
// por responsable o antes y después de una etapa.
const sinTildes = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const time = (seconds: number | null) => (seconds === null ? null : duration(seconds));
const pct = (share: number | null) => (share === null ? null : round(share * 100, 0));

const turnsOut = (turns: ReplyTurn[]) => {
  const s = turnStats(turns);
  return {
    leads: s.leads,
    vueltas: s.turns,
    mediana: time(s.median),
    mediana_en_horario: time(s.medianInHours),
    mediana_fuera_de_horario: time(s.medianOffHours),
    p75: time(s.p75),
    p90: time(s.p90),
    respondidas_en_15_min_pct: pct(s.within15),
    respondidas_en_1_hora_pct: pct(s.within60),
    sin_respuesta: s.unanswered,
  };
};

const crmAtencion: AgentTool = {
  area: "crm",
  definition: {
    name: "crm_atencion",
    description:
      "Tiempos de respuesta del chat del CRM (WhatsApp/Instagram vía Kommo) de un cliente en el período: la primera respuesta a los leads nuevos (lo mismo que la solapa CRM) y el tiempo de respuesta en cada vuelta de la conversación (el cliente escribe → la empresa contesta), con medianas dentro y fuera del horario de atención, percentiles y mensajes sin respuesta. Con `agrupar` lo corta por la etapa en que estaba el lead al escribir o por responsable; con `etapa_corte` compara antes y después de que el lead entrara a esa etapa (p. ej. \"segunda reunión\"). Solo para clientes con Kommo; hay mensajes de los últimos 90 días.",
    input_schema: {
      type: "object",
      properties: {
        ...CLIENTE_PROP,
        ...PERIODO_PROP,
        agrupar: { type: "string", enum: ["etapa", "responsable"], description: "Cortar las vueltas por la etapa del lead al momento del mensaje o por responsable del lead." },
        etapa_corte: { type: "string", description: "Etapa del CRM para comparar antes y después de que el lead entrara a ella (nombre aproximado, sin importar tildes ni mayúsculas)." },
      },
      required: ["cliente"],
    },
  },
  run: async (input) => {
    const client = await findClient(input.cliente);
    requireIntegration(client, "crm");
    const secrets = await getCrmSecrets(client.id);
    if (secrets?.provider !== "kommo") {
      return { cliente: client.name, aviso: "Los tiempos de respuesta del chat solo se miden con Kommo, y este cliente usa otro CRM." };
    }

    const range = periodFrom(input);
    const [events, storedSince, leads, history] = await Promise.all([
      getChatEvents(client.id, range),
      getChatStart(client.id),
      getLeads(client.id),
      getStageEvents(client.id),
    ]);
    if (events === null) return { cliente: client.name, aviso: "Los chats del CRM todavía no se guardan (falta una migración en la base)." };
    if (!events.length) return { cliente: client.name, periodo: periodOut(range), aviso: "No hay mensajes guardados en ese período (se conservan 90 días)." };

    const stages = history ?? [];
    const turns = replyTurns(events, { leads, period: range, stages });
    const first = chatStats(events, { leads, period: range, storedSince }).total;
    const stageNote =
      history === null
        ? "El historial de etapas todavía no se guarda (falta una migración en la base): la etapa de cada mensaje es la actual del lead, no la que tenía al escribir. No compares antes y después de una etapa con este dato."
        : !stages.length
          ? "Todavía no hay historial de etapas sincronizado: la etapa de cada mensaje es la actual del lead."
          : null;

    const out: Record<string, unknown> = {
      cliente: client.name,
      periodo: periodOut(range),
      criterio: `Vuelta = el cliente escribe (el primer mensaje después de una respuesta) y la empresa contesta; las medianas son con reloj corrido. Horario de atención supuesto: ${WORK_HOURS.label} (sin confirmar con el cliente). Sin respuesta = nadie contestó hasta el último sync. Solo leads que cuentan (sin excluidos). Las vueltas de charlas ya empezadas suelen ser de pocos minutos: para medir cuánto espera una consulta nueva, usá primera_respuesta.`,
      mensajes_guardados_desde: storedSince ? localDate(storedSince) : null,
      ...(stageNote ? { aviso_etapas: stageNote } : {}),
      primera_respuesta: {
        leads_nuevos_que_escribieron: first.leads,
        mediana: time(first.medianResponse),
        mediana_en_horario: time(first.medianInHours),
        mediana_fuera_de_horario: time(first.medianOffHours),
        respondidos_en_15_min_pct: pct(first.fastShare),
        sin_respuesta: first.unanswered,
      },
      vueltas: turnsOut(turns),
    };

    const agrupar = str(input.agrupar);
    if (agrupar === "etapa") {
      const order = secrets.stage_order ?? [];
      const rank = (name: string) => (order.includes(name) ? order.indexOf(name) : order.length);
      const names = [...new Set(turns.map((t) => t.stage ?? "Sin etapa"))].sort((a, b) => rank(a) - rank(b));
      out.por_etapa = names.map((name) => ({ etapa: name, ...turnsOut(turns.filter((t) => (t.stage ?? "Sin etapa") === name)) }));
    } else if (agrupar === "responsable") {
      const owners = new Map(leads.map((l) => [l.external_id, l.owner ?? "Sin responsable"]));
      const names = [...new Set(turns.map((t) => owners.get(t.leadId) ?? "Sin responsable"))];
      out.por_responsable = names.map((name) => ({ responsable: name, ...turnsOut(turns.filter((t) => (owners.get(t.leadId) ?? "Sin responsable") === name)) }));
    }

    const corte = str(input.etapa_corte);
    if (corte) {
      const known = [...new Set([...(secrets.stage_order ?? []), ...stages.flatMap((s) => (s.to_stage ? [s.to_stage] : []))])];
      const needle = sinTildes(corte);
      const stage = known.find((n) => sinTildes(n) === needle) ?? known.find((n) => sinTildes(n).includes(needle));
      if (!stage) throw new ToolError(`No hay ninguna etapa que se llame "${corte}". Las etapas son: ${known.join(", ")}.`);
      const entries = stageEntries(stages, stage);
      const after = (t: ReplyTurn) => {
        const at = entries.get(t.leadId);
        return !!at && t.at >= at;
      };
      out.corte = {
        etapa: stage,
        leads_que_entraron: entries.size,
        nota: "Antes y después según cuándo entró cada lead a la etapa (historial de Kommo). Con pocos leads en \"despues\", es una tendencia y no un dato firme.",
        antes: turnsOut(turns.filter((t) => !after(t))),
        antes_solo_los_que_llegaron: turnsOut(turns.filter((t) => entries.has(t.leadId) && !after(t))),
        despues: turnsOut(turns.filter(after)),
      };
    }
    return out;
  },
};

// ---------- Equipo ----------

const equipo: AgentTool = {
  area: "equipo",
  definition: {
    name: "equipo",
    description: SHOW_TASKS
      ? "Miembros del equipo con su rol, áreas habilitadas, clientes asignados y cuántas tareas abiertas tiene cada uno."
      : "Miembros del equipo con su rol, áreas habilitadas y clientes asignados.",
    input_schema: { type: "object", properties: {} },
  },
  run: async () => {
    const [team, clients, tasks] = await Promise.all([
      getTeam(),
      getClients(),
      SHOW_TASKS ? getTasks().catch(() => []) : [],
    ]);
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
      ...(SHOW_TASKS ? { tareas_abiertas: openByUser.get(m.id) ?? 0 } : {}),
    }));
  },
};

// Con las tareas ocultas (SHOW_TASKS) la tool no existe para el modelo.
const ALL_TOOLS = [listarClientes, ...(SHOW_TASKS ? [tareas] : []), metaMetricas, metaCampanas, crmResumen, crmLeads, crmAtencion, equipo];

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
