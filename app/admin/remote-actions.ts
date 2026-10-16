"use server";

// Recepción e Historial "a distancia": para computadoras sin agente local.
// Solo se leen metadatos de Supabase; ningún documento sale de la PC del negocio.
// Entregar o cancelar deja una SOLICITUD que el agente de esa PC aplica.

import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

export interface RemoteDocument {
  id: string;
  original_file_name: string;
  page_count: number | null;
  size_class: string | null;
  paper_size: string | null;
  copies: number | null;
  color_mode: "bw" | "color" | null;
  duplex: "simplex" | "long" | "short" | null;
  status: string;
  received_at: string;
}

export interface RemoteJob {
  id: string;
  document_id: string;
  kind: string;
  status: string;
  created_at: string;
}

export interface RemoteCommand {
  id: string;
  action: "finish" | "cancel";
  status: "pending" | "done" | "rejected";
  requested_by_email: string | null;
  requested_at: string;
  processed_at: string | null;
  result_message: string | null;
}

export interface RemoteOrder {
  id: string;
  correlative: string;
  customer_name: string;
  notes: string | null;
  status: "open" | "finished" | "cancelled";
  total_price: number;
  created_at: string;
  finished_at: string | null;
  purge_after: string | null;
  keep_documents: boolean;
  documents_deleted_at: string | null;
  reception_documents: RemoteDocument[];
  reception_print_jobs: RemoteJob[];
  reception_commands: RemoteCommand[];
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const ORDER_FIELDS =
  "id, correlative, customer_name, notes, status, total_price, created_at, finished_at, purge_after, keep_documents, documents_deleted_at, " +
  "reception_documents(id, original_file_name, page_count, size_class, paper_size, copies, color_mode, duplex, status, received_at), " +
  "reception_print_jobs(id, document_id, kind, status, created_at)";

async function staffClient() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("role, is_active").eq("id", user.id).single();
  if (!profile?.is_active || !["admin", "operator"].includes(profile.role ?? "")) return null;
  return supabase;
}

/** Pedidos abiertos con sus documentos, impresiones y solicitudes recientes. */
export async function getRemoteReception(): Promise<Result<{ orders: RemoteOrder[]; unassigned: number }>> {
  const supabase = await staffClient();
  if (!supabase) return { ok: false, error: "No autorizado" };

  const openOrders = (withCommands: boolean) =>
    supabase
      .from("reception_orders")
      .select(withCommands
        ? `${ORDER_FIELDS}, reception_commands(id, action, status, requested_by_email, requested_at, processed_at, result_message)`
        : ORDER_FIELDS)
      .eq("status", "open")
      .order("created_at");

  const [first, unassigned] = await Promise.all([
    openOrders(true),
    supabase
      .from("reception_documents")
      .select("id", { count: "exact", head: true })
      .is("order_id", null)
      .in("status", ["queued", "converting", "ready", "error"]),
  ]);
  // Sin la migración 009 los pedidos se muestran igual; solo faltan las solicitudes.
  const orders = first.error && /reception_commands/.test(first.error.message) ? await openOrders(false) : first;
  if (orders.error) return { ok: false, error: orders.error.message };
  const list = ((orders.data ?? []) as unknown as RemoteOrder[]).map((o) => ({ ...o, reception_commands: o.reception_commands ?? [] }));
  return { ok: true, data: { orders: list, unassigned: unassigned.count ?? 0 } };
}

/** Pedidos cerrados; busca por cliente, número de pedido o nombre de documento. */
export async function getRemoteHistory(q: string): Promise<Result<RemoteOrder[]>> {
  const supabase = await staffClient();
  if (!supabase) return { ok: false, error: "No autorizado" };

  // Solo letras, números y separadores comunes: el texto va dentro de un filtro de PostgREST.
  const term = String(q ?? "").replace(/[^\p{L}\p{N}\s\-_.]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  let query = supabase
    .from("reception_orders")
    .select(ORDER_FIELDS)
    .in("status", ["finished", "cancelled"])
    .order("finished_at", { ascending: false })
    .limit(50);

  if (term) {
    const like = `%${term}%`;
    const { data: docs } = await supabase
      .from("reception_documents")
      .select("order_id")
      .ilike("original_file_name", like)
      .not("order_id", "is", null)
      .limit(200);
    const ids = [...new Set((docs ?? []).map((d) => d.order_id as string))];
    const byDoc = ids.length ? `,id.in.(${ids.join(",")})` : "";
    query = query.or(`customer_name.ilike.${like},correlative.ilike.${like}${byDoc}`);
  }

  const { data, error } = await query;
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as unknown as RemoteOrder[] };
}

const requestSchema = z.object({
  orderId: z.string().uuid(),
  action: z.enum(["finish", "cancel"]),
});

/** Pide a la PC del negocio que entregue o cancele un pedido. */
export async function requestOrderAction(orderId: string, action: "finish" | "cancel"): Promise<Result<null>> {
  const parsed = requestSchema.safeParse({ orderId, action });
  if (!parsed.success) return { ok: false, error: "Solicitud inválida" };

  const supabase = await staffClient();
  if (!supabase) return { ok: false, error: "No autorizado" };

  // Quién y cuándo los completa la base de datos (sql/009_remote_commands.sql).
  const { error } = await supabase.from("reception_commands").insert({ order_id: parsed.data.orderId, action: parsed.data.action });
  if (error) {
    if (error.code === "23505") return { ok: false, error: "Ya hay una solicitud pendiente para este pedido." };
    if (/reception_commands/.test(error.message)) {
      return { ok: false, error: "Falta ejecutar la migración sql/009_remote_commands.sql en Supabase." };
    }
    return { ok: false, error: "No se pudo registrar la solicitud: el pedido ya no está abierto o no tiene permiso." };
  }
  return { ok: true, data: null };
}
