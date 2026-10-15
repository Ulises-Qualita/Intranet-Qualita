---
paths:
  - "lib/agent/**"
  - "components/agent/**"
  - "app/api/agente/**"
  - "**/agente/**"
  - "lib/ai-*.ts"
  - "**/gastos/**"
---

# Agente

(Movido desde CLAUDE.md: se carga solo al trabajar con estos archivos.)
- Agente: dos vistas del mismo componente (`components/agent/agent-conversation.tsx`)
  — la burbuja de `app/(app)/layout.tsx` y la pantalla completa `/agente`, que es
  también una solapa del sidebar (sin área propia: aparece con cualquiera
  habilitada). El botón de expandir pasa el hilo por `?hilo=`, que la página lee en
  el server. Backend: `POST /api/agente` con SSE. `ANTHROPIC_API_KEY` solo en el server; el modelo no recibe datos en el
  prompt, los pide con tools. `lib/agent/tools.ts` envuelve `lib/data.ts` y **la
  lista de tools es el control de acceso**: se arma por request con `canAccess`, así
  que un área sin habilitar no existe para el modelo (y adentro la RLS vuelve a
  validar porque leen con la sesión del usuario). `lib/agent/prompt.ts` (system
  prompt cacheado, estable en toda la conversación), `lib/agent/threads.ts`
  (historial en `intranet_agent_threads` / `intranet_agent_messages`, solo el texto
  de cada turno, nunca los resultados de las tools). Modelo y esfuerzo por uso
  (agente / reportes) los elige un admin en `/admin/gastos` (fila `ai` de
  `intranet_settings`; `lib/ai-models.ts` client-safe, `lib/ai-config.ts` server);
  sin elegir, `ANTHROPIC_MODEL` y si no `claude-opus-5-5`. Solo modelos con thinking
  adaptativo y `effort` (Haiku 4.5 no). El loop cachea también los mensajes
  (`cache_control` arriba de todo) para que los resultados de tools reenviados en
  cada vuelta se cobren como lectura de caché; `crm_leads` tiene tope de 50. El render del chat soporta un
  markdown acotado (`components/agent/rich-text.tsx`): sin tablas, y el prompt lo
  dice. `lib/agent/usage.ts` registra tokens y costo estimado por consulta en
  `intranet_agent_usage` (precios por millón en una tabla del módulo; el costo se
  guarda ya convertido para que las filas viejas no cambien de valor), y alimenta
  las cards de gasto de `/admin/gastos`. La misma tabla registra todo el consumo de IA,
  separado por `kind` (`agente` | `reporte` | `analisis`, lista en `USAGE_KINDS`;
  `docs/sql/2026-09-28-uso-por-tipo.sql`): `recordUsage(kind, …)` y `getAiUsage()`,
  y `/admin/gastos` muestra un bloque por tipo.
