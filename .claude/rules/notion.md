---
paths:
  - "lib/notion*.ts"
  - "lib/tasks.ts"
  - "**/admin/notion/**"
  - "**/notion/**"
  - "**/tareas/**"
  - "components/notion-content.tsx"
---

# Notion (tareas)

(Movido desde CLAUDE.md: se carga solo al trabajar con estos archivos.)
- Notion: fuente de verdad de las **tareas**, en **solo lectura** y **en vivo** (no se
  espeja en Supabase). Integración *interna* del workspace: un único `NOTION_TOKEN` (env,
  server), no OAuth por cliente. Dos niveles de config:
  - Global, en `/admin/notion` → fila `notion` de `intranet_settings`: qué data source es
    Proyectos y cuál Tickets, y el mapeo de propiedades (estado → las 3 columnas,
    prioridad, responsable, vencimiento, relación a Proyecto). Se elige desde la UI, no
    está hardcodeado.
  - Por cliente, en `/clientes/[slug]/notion/conectar` → `intranet_client_integrations`
    con provider `notion` y `account_ref` = page id del proyecto. Un proyecto por cliente;
    los tickets de proyectos sin cliente se ignoran.
  - `lib/notion.ts` (API, solo server), `lib/notion-map.ts` (traducción pura, client-safe),
    `lib/tasks.ts` (modelo de tarea, client-safe). Desde la versión `2025-09-03` de la API
    las databases contienen *data sources* y el query es
    `POST /v1/data_sources/{id}/query`: consultar los docs, no ir de memoria.
  - Cache: una sola query trae los tickets de todo el estudio (la DB de Tickets es única).
    Se cachea solo esa query cruda con `unstable_cache` (60s, tag `notion-tickets`), porque
    `getTasks()` corre en `app/(app)/layout.tsx` en cada render. El mapeo ticket → cliente
    va fuera del cache, por request, para respetar la RLS. `"use cache"` no se usa: exige
    activar `cacheComponents` en todo el proyecto. Invalidación con
    `revalidateTag(tag, { expire: 0 })` — en Next 16 la forma de un solo argumento está
    deprecada.
  - Si Notion falla, `getTasks()` nunca tira: devuelve las tareas de Supabase y el motivo
    en `notionError`, que la vista de Tareas muestra como aviso.
