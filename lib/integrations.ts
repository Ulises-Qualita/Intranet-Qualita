// Compartido entre server y cliente. Coincide con intranet_client_integrations.provider.
export const INTEGRATIONS = [
  {
    value: "meta",
    label: "Meta",
    title: "Meta Ads",
    refLabel: "ID de la cuenta publicitaria",
    placeholder: "act_1234567890",
    help: "Cuenta de Meta Business del cliente de donde salen las métricas de anuncios.",
  },
  {
    value: "crm",
    label: "CRM",
    title: "CRM",
    refLabel: "CRM y cuenta",
    placeholder: "Ej.: HubSpot · portal 12345678",
    help: "CRM del cliente de donde salen el pipeline, las etapas y los leads.",
  },
  {
    value: "whatsapp",
    label: "WhatsApp",
    title: "WhatsApp Business",
    refLabel: "Número de WhatsApp Business",
    placeholder: "+54 9 11 1234-5678",
    help: "Línea de WhatsApp Business del cliente para las conversaciones.",
  },
] as const;

export type Integration = (typeof INTEGRATIONS)[number]["value"];

export const isIntegration = (value: unknown): value is Integration => INTEGRATIONS.some((i) => i.value === value);

export const integrationMeta = (value: Integration) => INTEGRATIONS.find((i) => i.value === value)!;

export type IntegrationState = { connected: boolean; accountRef: string | null; connectedAt: string | null };
