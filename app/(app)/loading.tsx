// Un loading.tsx solo aparece cuando cambia el segmento que envuelve: este cubre
// las solapas de la sidebar; los de clientes/, [id]/ y las vistas con filtro de
// días (meta y crm: ?dias= cambia solo la página) cubren el resto.
export { ViewSkeleton as default } from "@/components/skeleton";
