// Ingresos del flujo local (recepción por carpeta).
// Regla de negocio: un pedido cuenta como cobrado al marcarlo "Entregado".
// Los pedidos cancelados no suman. La fecha del ingreso es la de entrega.
import type { SupabaseClient } from "@supabase/supabase-js";

interface PrintedJob {
  kind: string;
  status: string;
  color_mode: "bw" | "color";
  page_count: number;
  copies: number;
  price: number;
}

export interface DeliveredOrder {
  id: string;
  correlative: string;
  customer_name: string;
  total_price: number;
  finished_at: string;
  reception_print_jobs: PrintedJob[];
}

/** Pedidos entregados en un rango de fechas de entrega. Si falta la migración 008 devuelve vacío. */
export async function fetchDeliveredOrders(
  supabase: SupabaseClient,
  { since, until, limit }: { since?: string; until?: string; limit?: number }
): Promise<DeliveredOrder[]> {
  let query = supabase
    .from("reception_orders")
    .select("id, correlative, customer_name, total_price, finished_at, reception_print_jobs(kind, status, color_mode, page_count, copies, price)")
    .eq("status", "finished")
    .order("finished_at", { ascending: false });
  if (since) query = query.gte("finished_at", since);
  if (until) query = query.lte("finished_at", until);
  if (limit) query = query.limit(limit);
  const { data, error } = await query;
  if (error) return [];
  return (data ?? []) as unknown as DeliveredOrder[];
}

/** Medianoche de hoy en Guatemala (UTC-6, sin horario de verano), sin depender de la zona del servidor. */
export function startOfTodayGT(now = new Date()): string {
  const day = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Guatemala" }).format(now); // AAAA-MM-DD
  return new Date(`${day}T00:00:00-06:00`).toISOString();
}

/** Límites de un día de calendario de Guatemala (AAAA-MM-DD), como instantes exactos. */
export const dayStartGT = (day: string) => `${day}T00:00:00-06:00`;
export const dayEndGT = (day: string) => `${day}T23:59:59.999-06:00`;

/** Inicio de hoy, de la semana (domingo) y del mes, según el calendario de Guatemala. */
export function periodStartsGT(now = new Date()) {
  const today = new Date(startOfTodayGT(now));
  // Con el desfase fijo de -6 h, las partes UTC de este instante son la fecha de Guatemala.
  const gt = new Date(today.getTime() - 6 * 3600000);
  const DAY = 86400000;
  return {
    today: today.toISOString(),
    week: new Date(today.getTime() - gt.getUTCDay() * DAY).toISOString(),
    month: new Date(today.getTime() - (gt.getUTCDate() - 1) * DAY).toISOString(),
  };
}

export type DocBucket = "pending" | "queued" | "printed" | "cancelled" | "failed";

export interface ReceivedDoc {
  id: string;
  status: string;
  color_mode: "bw" | "color" | null;
  paper_size: string | null;
  size_class: string | null;
  reception_print_jobs: { kind: string; status: string; created_at: string }[];
}

/** Documentos recibidos por carpeta desde una fecha, con sus trabajos de impresión. */
export async function fetchReceivedDocuments(supabase: SupabaseClient, since: string): Promise<ReceivedDoc[]> {
  const { data, error } = await supabase
    .from("reception_documents")
    .select("id, status, color_mode, paper_size, size_class, reception_print_jobs(kind, status, created_at)")
    .gte("received_at", since);
  if (error) return [];
  return (data ?? []) as unknown as ReceivedDoc[];
}

/** En qué punto del flujo está un documento, según su último trabajo de impresión. */
export function docBucket(doc: ReceivedDoc): DocBucket {
  if (doc.status === "error") return "failed";
  if (doc.status === "discarded") return "cancelled";
  const last = [...doc.reception_print_jobs].sort((a, b) => a.created_at.localeCompare(b.created_at)).at(-1);
  if (!last) return "pending";
  if (last.status === "ready" || last.status === "sending") return "queued";
  if (last.status === "sent" || last.status === "printing" || last.status === "printed") return "printed";
  if (last.status === "error" || last.status === "unknown") return "failed";
  return "cancelled";
}

/** Papel en que se imprime (o imprimirá) el documento. */
export const docPaper = (doc: ReceivedDoc) => doc.paper_size ?? doc.size_class ?? "sin analizar";

// Solo la impresión original confirmada: las reimpresiones no se cobran solas.
const charged = (o: DeliveredOrder) => o.reception_print_jobs.filter((j) => j.kind === "print" && j.status === "printed");

export function localRevenue(orders: DeliveredOrder[]) {
  return orders.reduce((acc, o) => acc + Number(o.total_price), 0);
}

export function localPages(orders: DeliveredOrder[], color?: "bw" | "color") {
  return orders.reduce(
    (acc, o) => acc + charged(o).filter((j) => !color || j.color_mode === color).reduce((a, j) => a + j.page_count * j.copies, 0),
    0
  );
}

/** Desglose por tipo de impresión, a partir de los trabajos impresos de cada pedido. */
export function localByColor(orders: DeliveredOrder[], color: "bw" | "color") {
  const jobs = orders.flatMap((o) => charged(o).filter((j) => j.color_mode === color));
  return {
    revenue: Math.round(jobs.reduce((a, j) => a + Number(j.price), 0) * 100) / 100,
    jobs: jobs.length,
    pages: jobs.reduce((a, j) => a + j.page_count * j.copies, 0),
  };
}
