---
paths:
  - "lib/alerts/**"
  - "lib/telegram.ts"
  - "app/(app)/admin/alerts-*.ts*"
  - "app/(app)/admin/(tabs)/alertas/**"
  - "app/api/cron/**"
---

# Alertas por Telegram

- Pedido (2026-11-26): avisos por Telegram cuando se cae una integración (para
  Ulises), una cuenta de Meta/Google Ads no gastó en el día (Palo y Ale), baja la
  facturación contra el mes anterior (Pedro) o un creativo anda mal (Palo y Ale).
  **Por ahora todo va a Ulises**: se reparte después en Administración → Alertas.
- Bot propio (`lib/telegram.ts`, env `TELEGRAM_BOT_TOKEN`, creado con @BotFather).
  Vincular: el admin genera un link `t.me/<bot>?start=<código>` por persona
  (`createTelegramLink`), la persona toca «Iniciar» y «Verificar» busca el
  `/start <código>` con `getUpdates` (sin webhook; sin offset para no pisar
  vínculos pendientes). Tablas `intranet_telegram_links` e `intranet_alerts`
  (`docs/sql/2026-11-26-alertas.sql`), sin políticas: solo service_role.
  Destinatarios por tipo en `intranet_settings`, fila `alerts`
  (`{ recipients: { tipo: [profile ids] } }`); un tipo sin entrada va a los admins
  con Telegram vinculado.
- Corre al final de `app/api/cron/sync` (`runAlerts`, `?alertas=0` lo saltea): la
  corrida de la mañana (13 UTC = 10 AR; la de la tarde, 19 UTC = 16 AR) hace todo, la de la tarde solo integraciones.
  Estado por cosa vigilada en `intranet_alerts.key`: se avisa al pasar a mal (o una
  vez por día si `repeatDaily`), se cierra al volver a bien (con aviso solo si el
  chequeo trae `resolved`). Si no se le pudo mandar a nadie, no se marca enviada.
  Un chequeo que falla deja sus alertas abiertas como estaban.
- Criterios (`lib/alerts/checks.ts`, elegidos con el usuario):
  - Integración: `sync_error` en los secrets de Meta, Google Ads, CRM o Clarity
    conectados; y el token de Meta que vence en menos de 5 días. Avisa al volver.
  - Sin gasto: ayer 0 en `intranet_meta_daily` / `intranet_gads_daily` con al
    menos 3 de los 7 días anteriores con gasto, solo si la cuenta sincronizó bien
    hoy. Avisa al volver a gastar.
  - Facturación: del 1 a ayer contra los mismos días del mes anterior, como Vista
    general (planilla por fecha de confirmación o ganadas del CRM por `won_at`;
    dólares al oficial de hoy en los dos lados). Caída de 20% o más, desde el día 8,
    una vez por día mientras siga. Se saltea con `sales_off` sin planilla.
  - Creativos (Meta): anuncio activo con gasto en los últimos 2 días; en 7 días,
    CPL ≥ 2× el de su campaña (y gasto ≥ 1 CPL de la campaña) o sin leads con
    gasto ≥ 2 CPL. La campaña necesita 3 leads y 2 anuncios con gasto. Van juntos
    en un mensaje por cliente; una vez por anuncio, se cierran sin aviso.
