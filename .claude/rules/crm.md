---
paths:
  - "lib/crm*.ts"
  - "lib/kommo.ts"
  - "lib/odoo.ts"
  - "lib/sales-sheet.ts"
  - "**/crm/**"
---

# CRM

(Movido desde CLAUDE.md: se carga solo al trabajar con estos archivos.)
- **Una venta cuenta en el mes en que pasó a ganada, no en el que se creó el lead**
  (pedido del usuario: un lead de agosto que se gana en octubre es venta de octubre).
  `intranet_leads.won_at` (`docs/sql/2026-10-15-crm-won-at.sql`), cargado en el sync:
  Odoo → `getOdooWonDates` (`lib/odoo.ts`), la **primera** entrada a una etapa ganada
  según `mail.tracking.value` del campo `stage_id`, comparando por **id** de etapa
  (`new_value_integer`; por nombre se pierden registros viejos). Primera y no última
  porque después de la venta el lead sigue por etapas ganadas (En fábrica → En
  producción). Kommo → `closed_at` de las ganadas (y las cerradas se filtran por
  cierre, no por creación). Con planilla → la fecha de confirmación. Si no se sabe,
  `saleDay()` de `lib/data.ts` usa la creación. En `crmPeriod` las oportunidades
  van por creación y las ventas (`sold`: ganadas, tickets, facturación, ventas por
  origen, ganadas por vendedor / anuncio / etiqueta) por fecha de venta; la
  conversión sigue siendo de las creadas en el período. Lo usan la solapa CRM,
  Vista general, el agente y los reportes. `date_last_stage_update` **no** sirve
  para esto (es el último cambio, incluidos los movimientos entre etapas ganadas).
- Qué leads del CRM cuentan (contexto de Arteplac en `docs/contexto-kommo.md`): no todo
  lead es una consulta nueva. `crmExclusions` de `lib/crm-shared.ts` marca en el sync los
  que no cuentan y el motivo va a `intranet_leads.excluded`
  (`docs/sql/2026-10-02-crm-leads-base.sql`): `stage` (etapas excluidas, p. ej. "Equipo
  interno"), `before_start` (anteriores al día desde el que el registro es completo),
  `returning` (el contacto existía en el CRM más de un día antes que el lead: al conectar
  un WhatsApp, Kommo importa la agenda y cada cliente viejo que escribe nace como lead
  nuevo; se detecta con `contact_created_at`) y `duplicate` (mismo teléfono que un lead
  anterior; el teléfono no se guarda). `getLeads()` ya los deja afuera, así que vistas,
  agente y reportes quedan corregidos sin tocarlos. `getExcludedLeads()` da cuántos
  quedaron afuera y por qué; la solapa CRM ya no muestra ese aviso (se sacó a pedido). La fecha y las etapas se eligen por cliente en
  `/clientes/[slug]/crm/conectar` → "Qué leads se cuentan" (`since` y `excluded_stages`
  en los secrets del CRM). En Odoo solo aplican esas dos.
- Ventas desde planilla (Arteplac: la etapa CONFIRMADO y el "Presupuesto $" de Kommo no
  son confiables). Se conecta por cliente en `/clientes/[slug]/crm/conectar` → "Ventas
  desde una planilla" (`sales_sheet` en los secrets del CRM). `lib/sales-sheet.ts` lee
  con la **API de Sheets** como `GOOGLE_DRIVE_USER` (scope `drive`, el de la
  delegación; la API tiene que estar habilitada en el proyecto de Cloud de la cuenta
  de servicio) dos pestañas que se cruzan por número de proyecto: **Proyectos**
  (teléfono, Total valor pesos / USD) y **Cotizaciones** (Fecha confirmación de
  proyecto, Vendedor); columnas por encabezado. Corre dentro de `syncCrmClient`: guarda
  `intranet_crm_sales` (`docs/sql/2026-10-06-ventas-planilla.sql`) y cruza cada venta
  por teléfono y, si no hay, por nombre (`matchSales`, solo leads creados hasta la
  confirmación; el nombre del cliente contra el del contacto de Kommo o el del lead:
  todas las palabras del más corto, al menos dos, sin títulos, "Sole" = "Soledad"; si
  coinciden personas con distinto teléfono no cruza; `sales_stats.byName`) con su lead,
  que pasa a `won` con `amount` = pesos y `amount_usd` = dólares; con planilla, las
  etapas ganadas y los presupuestos del CRM no cuentan. **Una venta siempre cuenta como oportunidad**
  (pedido del usuario): `syncCrmClient` saca de `excluded` todo lead ganado, aunque sea
  `returning`, `duplicate` o `before_start`; si no, la venta quedaba en "Sin
  oportunidad en el CRM" sin origen ni anuncio. Un fallo va a
  `secrets.sales_error` y se siguen usando las ventas guardadas. **Pesos y dólares no
  se suman ni se convierten.** En la solapa CRM (`salesPeriod` de `lib/data.ts`) las
  ventas, la facturación y el ticket van por **fecha de confirmación** (por eso sí se
  comparan con el período anterior), y vendedores y ventas por origen salen de la
  planilla; en anuncios, videos y Vista general las oportunidades van por fecha del
  lead y las ganadas por `won_at` (= confirmación). El agente
  (`ventas_planilla` en `crm_resumen`) y los reportes la usan también.
- Anuncio del lead vs. Meta: el CRM puede guardar un nombre corto (Kommo de Arteplac:
  `TESTIMONIAL_WEB02` por `ATP_COC_A01_D07_TESTIMONIAL_VID_V01_WEB02`).
  `withMetaAdNames` (`lib/data.ts`) pasa cada anuncio del CRM al nombre de Meta antes de
  la tabla "Por anuncio" y los videos de la solapa CRM (y en `crm_resumen` del agente): exacto o con las partes en
  orden y la misma variante final; entre varios, el de más gasto. Los ids numéricos
  (Google Ads) quedan como están.
- Atención por chat en la solapa CRM (solo equipo, solo Kommo): `intranet_crm_chat_events`
  (`docs/sql/2026-10-01-crm-chats.sql`) guarda un registro por mensaje **sin el texto**,
  de la API de eventos de Kommo (`incoming_chat_message` / `outgoing_chat_message`).
  `lib/crm-chat-sync.ts` corre dentro de `syncCrmClient`: trae lo nuevo y completa
  hacia atrás hasta 30 días, 16 páginas por corrida (el cron tiene 60 s); un fallo ahí
  va a `secrets.chat_error`, no rompe el sync de oportunidades. `lib/crm-chats.ts`
  (`getChatEvents`, `chatStats`) y `crm/chat-monitor.tsx` arman el tiempo de la
  **primera respuesta por lead nuevo** del período (del primer entrante al primer
  saliente posterior, solo leads que cuentan; mediana con reloj corrido, separada
  según el lead haya escrito dentro o fuera del horario de atención, `WORK_HOURS`:
  lunes a viernes de 9 a 18 y sábados de 10 a 13, confirmado por Arteplac; antes se
  asumía sin sábados y los sábados a la mañana bajaban la mediana "fuera de horario"), respondidos en 15 min, sin
  respuesta y conversaciones esperando. No se mide cada ida y vuelta: daba 4 minutos
  por el ping-pong de charlas ya empezadas. Se
  agrupa por el **responsable del lead** y no por quién escribió: en Arteplac casi
  todos los salientes llegan sin usuario (`created_by` 0, responden desde la app de
  WhatsApp). El texto de los mensajes existe en `GET /api/v4/talks/{id}/messages`,
  pero pide el alcance "External chat history" (Chats API add-on) y hoy da 403.
- Historial de etapas (solo Kommo): `intranet_crm_stage_events`
  (`docs/sql/2026-10-22-crm-etapas.sql`), un registro por cambio de etapa
  (`lead_status_changed` de la API de eventos, nombres de etapa como en
  `intranet_leads.stage`). `lib/crm-stage-sync.ts` corre en `syncCrmClient` después de
  los chats: completa 95 días hacia atrás, 8 páginas por corrida, borra lo de más de
  180; un fallo va a `secrets.stage_error`. Los chats se conservan 90 días
  (`KEEP_DAYS` de `lib/crm-chat-sync.ts`). Lo usa `crm_atencion` del agente.
