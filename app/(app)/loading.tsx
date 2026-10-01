// Un loading.tsx solo aparece cuando cambia el segmento que envuelve: este cubre
// las solapas de la sidebar; los de clientes/ y clientes/[id]/ cubren el resto
// (este último con TabSkeleton: el encabezado del cliente es del layout).
export { ViewSkeleton as default } from "@/components/skeleton";
