// Utilidades de auth sin dependencias de server, usables desde proxy.ts y el cliente.

export const ALLOWED_DOMAIN = "qualita.studio";

export const isQualitaEmail = (email?: string | null) =>
  !!email && email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`);

// Claves de intranet_profiles.areas
export const AREAS = [
  ["inicio", "Inicio"],
  ["equipo", "Equipo"],
  ["clientes", "Clientes"],
  ["meta", "META"],
  ["crm", "CRM"],
  ["tareas", "Tareas"],
  ["admin", "Admin"],
] as const;

export type AreaKey = (typeof AREAS)[number][0];
export type Role = "admin" | "member";

export type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: Role;
  areas: Partial<Record<AreaKey, boolean>> | null;
  active: boolean;
};

export const canAccess = (profile: Profile | null, area: AreaKey) =>
  !!profile && profile.active && (profile.role === "admin" || profile.areas?.[area] === true);

export const initialsOf = (name: string) =>
  name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .map((x) => x[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
