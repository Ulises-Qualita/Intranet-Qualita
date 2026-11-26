// Tipos de alerta. Compartido entre server y cliente (sin imports de server).

export const ALERT_TYPES = [
  {
    key: "integration",
    label: "Integración caída",
    detail:
      "Meta, Google Ads, CRM o Clarity dejaron de sincronizar (permiso quitado, token vencido, clave cambiada), o el acceso a Meta vence en menos de 5 días. Avisa también cuando vuelve.",
  },
  {
    key: "spend",
    label: "Cuenta sin gasto",
    detail:
      "Una cuenta de Meta o Google Ads que venía gastando no gastó nada ayer: suele ser falta de presupuesto o de saldo. Avisa también cuando vuelve a gastar.",
  },
  {
    key: "billing",
    label: "Baja de facturación",
    detail:
      "Lo facturado en el mes hasta ayer está 20% o más por debajo de los mismos días del mes anterior (la facturación de Vista general). Desde el día 8 del mes, una vez por día mientras siga.",
  },
  {
    key: "creative",
    label: "Creativo con mal rendimiento",
    detail:
      "Un anuncio activo de Meta que en los últimos 7 días tiene un CPL del doble o más que su campaña, o que gastó lo de 2 leads de la campaña sin traer ninguno. Avisa una vez por anuncio.",
  },
] as const;

export type AlertType = (typeof ALERT_TYPES)[number]["key"];

export const isAlertType = (v: unknown): v is AlertType => ALERT_TYPES.some((t) => t.key === v);

// intranet_settings, fila "alerts": quién recibe cada tipo (ids de perfil). Un
// tipo sin entrada va a los admins con Telegram vinculado.
export const ALERTS_SETTINGS_KEY = "alerts";
export type AlertSettings = { recipients?: Partial<Record<AlertType, string[]>> };
