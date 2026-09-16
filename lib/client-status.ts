// Compartido entre server y cliente. Coincide con el check de intranet_clients.status.
export const CLIENT_STATUSES = [
  { value: "lead", label: "Lead", pill: "warm" },
  { value: "onboarding", label: "Onboarding", pill: "onboarding" },
  { value: "cliente", label: "Cliente", pill: "al-dia" },
] as const;

export type ClientStatus = (typeof CLIENT_STATUSES)[number]["value"];

export const isClientStatus = (value: unknown): value is ClientStatus =>
  CLIENT_STATUSES.some((s) => s.value === value);

export const statusMeta = (status: ClientStatus) => CLIENT_STATUSES.find((s) => s.value === status)!;
