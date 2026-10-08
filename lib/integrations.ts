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
    value: "google_ads",
    label: "Google Ads",
    title: "Google Ads",
    refLabel: "Cuenta de Google Ads",
    placeholder: "123-456-7890",
    help: "Cuenta de anuncios del cliente bajo la MCC del estudio, de donde salen las métricas de la solapa GADS.",
  },
  {
    value: "notion",
    label: "Notion",
    title: "Notion",
    refLabel: "Proyecto de Notion",
    placeholder: "",
    help: "Proyecto del cliente en la database de Proyectos. Sus tickets se muestran en Tareas.",
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
    value: "clarity",
    label: "Clarity",
    title: "Microsoft Clarity",
    refLabel: "ID del proyecto de Clarity",
    placeholder: "abc123def4",
    help: "Proyecto de Microsoft Clarity del sitio del cliente, de donde salen las métricas de la solapa WEB.",
  },
  {
    value: "drive",
    label: "Drive",
    title: "Google Drive",
    refLabel: "Carpeta de Drive",
    placeholder: "",
    help: "Carpeta del cliente en la unidad compartida del estudio. El cliente la ve, descarga y sube archivos desde su cuenta.",
  },
] as const;

export type Integration = (typeof INTEGRATIONS)[number]["value"];

export const isIntegration = (value: unknown): value is Integration => INTEGRATIONS.some((i) => i.value === value);

export const integrationMeta = (value: Integration) => INTEGRATIONS.find((i) => i.value === value)!;

export type IntegrationState = { connected: boolean; accountRef: string | null; connectedAt: string | null };

// Integraciones que se conectan desde una pantalla propia (elegir cuenta o proyecto),
// no escribiendo la referencia a mano en el diálogo genérico.
export const CONNECT_PAGES = {
  meta: { path: "meta/conectar", manualError: "Meta se conecta iniciando sesión con Facebook." },
  google_ads: { path: "gads/conectar", manualError: "Google Ads se conecta eligiendo la cuenta de la lista de la MCC." },
  notion: { path: "notion/conectar", manualError: "Notion se conecta eligiendo el proyecto de la lista." },
  crm: { path: "crm/conectar", manualError: "El CRM se conecta cargando la cuenta y su clave de API." },
  clarity: { path: "web/conectar", manualError: "Clarity se conecta cargando el token de exportación del proyecto." },
  drive: { path: "drive/conectar", manualError: "Drive se conecta eligiendo la carpeta del cliente." },
} as const;

export const hasConnectPage = (provider: Integration): provider is keyof typeof CONNECT_PAGES => provider in CONNECT_PAGES;

export const connectPath = (provider: Integration, clientSlug: string) =>
  hasConnectPage(provider) ? `/clientes/${clientSlug}/${CONNECT_PAGES[provider].path}` : null;
