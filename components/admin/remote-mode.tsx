"use client";

// Vistas "a distancia" de Recepción e Historial, para computadoras sin agente local.
// Solo metadatos desde Supabase: no se pueden ver ni imprimir documentos desde aquí.

import { useCallback, useEffect, useState } from "react";
import { MonitorSmartphone, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getRemoteHistory, getRemoteReception, requestOrderAction,
  type RemoteCommand, type RemoteDocument, type RemoteJob, type RemoteOrder,
} from "@/app/admin/remote-actions";
import { COLOR_LABELS, DUPLEX_LABELS, PAPER_LABELS, dateGT, jobStatus, timeGT } from "@/lib/agent/labels";
import type { JobStatus } from "@/lib/agent/types";
import { cn, formatCurrency } from "@/lib/utils";

const REFRESH_MS = 10000;

export function RemoteBanner() {
  return (
    <div className="mb-4 flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
      <MonitorSmartphone className="mt-0.5 h-5 w-5 flex-shrink-0" />
      <div>
        <p className="font-semibold">Modo a distancia</p>
        <p className="text-xs">
          Esta computadora no tiene el agente de impresión. Puede ver los pedidos y marcarlos como Entregado o Cancelado;
          la PC del negocio aplica el cambio en unos segundos. Para ver documentos, asignar clientes o imprimir, use la PC del negocio.
        </p>
      </div>
    </div>
  );
}

function docLine(doc: RemoteDocument, jobs: RemoteJob[]) {
  const last = jobs.filter((j) => j.document_id === doc.id).sort((a, b) => a.created_at.localeCompare(b.created_at)).at(-1);
  if (last) return jobStatus({ status: last.status as JobStatus, hold_reason: null });
  if (doc.status === "error") return { label: "Error", color: "bg-red-100 text-red-700" };
  if (doc.status === "queued" || doc.status === "converting") return { label: "Convirtiendo…", color: "bg-purple-100 text-purple-700" };
  return { label: "Por imprimir", color: "bg-amber-100 text-amber-800" };
}

function DocumentList({ order }: { order: RemoteOrder }) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {order.reception_documents.map((d) => {
          const st = docLine(d, order.reception_print_jobs);
          const paper = d.paper_size ?? d.size_class;
          return (
            <tr key={d.id} className="border-b border-gray-50 last:border-0">
              <td className="px-4 py-2">
                <p className="font-medium text-gray-900">{d.original_file_name}</p>
                <p className="text-xs text-gray-500">
                  {d.page_count ?? "?"} pág.{paper ? ` · ${PAPER_LABELS[paper as keyof typeof PAPER_LABELS] ?? paper}` : ""}
                </p>
              </td>
              <td className="px-4 py-2 text-xs text-gray-600">
                {d.copies ? `${d.copies} × ` : ""}
                {d.color_mode ? COLOR_LABELS[d.color_mode] : "—"}
                {d.duplex ? ` · ${DUPLEX_LABELS[d.duplex]}` : ""}
              </td>
              <td className="px-4 py-2 text-right">
                <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", st.color)}>{st.label}</span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function lastCommand(commands: RemoteCommand[]) {
  return [...commands].sort((a, b) => a.requested_at.localeCompare(b.requested_at)).at(-1);
}

export function RemoteReception() {
  const [orders, setOrders] = useState<RemoteOrder[] | null>(null);
  const [unassigned, setUnassigned] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await getRemoteReception();
    if (r.ok) {
      setOrders(r.data.orders);
      setUnassigned(r.data.unassigned);
    } else setError(r.error);
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  async function ask(order: RemoteOrder, action: "finish" | "cancel") {
    if (action === "cancel" && !confirm(`¿Cancelar el pedido de ${order.customer_name}?`)) return;
    setBusy(order.id);
    setError(null);
    const r = await requestOrderAction(order.id, action);
    if (!r.ok) setError(r.error);
    await load();
    setBusy(null);
  }

  return (
    <div>
      <RemoteBanner />
      {error && <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}
      {unassigned > 0 && (
        <p className="mb-3 text-sm text-gray-600">
          Hay {unassigned} documento(s) sin cliente en la PC del negocio.
        </p>
      )}
      {orders === null && <p className="text-sm text-gray-500">Cargando pedidos…</p>}
      {orders?.length === 0 && (
        <p className="rounded-xl border border-gray-200 bg-white px-4 py-12 text-center text-sm text-gray-400">No hay pedidos abiertos.</p>
      )}
      <div className="space-y-3">
        {orders?.map((o) => {
          const cmd = lastCommand(o.reception_commands ?? []);
          const pending = cmd?.status === "pending";
          const rejected = cmd?.status === "rejected" ? cmd : null;
          return (
            <div key={o.id} className="rounded-xl border border-gray-200 bg-white">
              <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-2.5">
                <span className="font-semibold text-gray-900">{o.customer_name}</span>
                <span className="font-mono text-xs text-blue-700">{o.correlative}</span>
                <span className="text-sm font-semibold">{formatCurrency(Number(o.total_price))}</span>
                <span className="text-xs text-gray-500">{timeGT(o.created_at)}</span>
                <div className="ml-auto flex items-center gap-2">
                  {pending ? (
                    <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-800">
                      {cmd!.action === "finish" ? "Entrega" : "Cancelación"} solicitada · aplicándose en la PC del negocio…
                    </span>
                  ) : (
                    <>
                      <Button size="sm" variant="outline" loading={busy === o.id} onClick={() => ask(o, "finish")}>Entregado</Button>
                      <Button size="sm" variant="ghost" className="text-red-600" disabled={busy === o.id} onClick={() => ask(o, "cancel")}>Cancelar</Button>
                    </>
                  )}
                </div>
              </div>
              {o.notes && <p className="border-b border-gray-100 px-4 py-1.5 text-xs text-gray-600">{o.notes}</p>}
              {rejected && (
                <p className="border-b border-gray-100 bg-red-50 px-4 py-1.5 text-xs text-red-700">
                  La PC del negocio no aplicó la última solicitud ({timeGT(rejected.processed_at)}): {rejected.result_message}
                </p>
              )}
              <DocumentList order={o} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function RemoteHistory() {
  const [q, setQ] = useState("");
  const [orders, setOrders] = useState<RemoteOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(async () => {
      const r = await getRemoteHistory(q);
      if (r.ok) {
        setOrders(r.data);
        setError(null);
      } else setError(r.error);
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  return (
    <div>
      <RemoteBanner />
      <div className="mb-4 rounded-xl border border-gray-200 bg-white p-3">
        <div className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-200">
          <Search className="h-5 w-5 flex-shrink-0 text-gray-400" />
          <input
            autoFocus
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setQ(""); }}
            placeholder="Buscar por nombre del cliente, número de pedido o nombre del documento"
            aria-label="Buscar en pedidos anteriores"
            className="min-w-0 flex-1 border-0 bg-transparent py-2.5 text-base focus:outline-none focus:ring-0"
          />
        </div>
        <p className="mt-2 text-xs text-gray-500">
          {orders ? `${orders.length === 50 ? "50 o más" : orders.length} pedido(s).` : "Cargando…"} La reimpresión solo está disponible en la PC del negocio.
        </p>
      </div>
      {error && <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}
      <div className="space-y-3">
        {orders?.map((o) => (
          <div key={o.id} className="rounded-xl border border-gray-200 bg-white">
            <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-2.5">
              <span className="font-semibold text-gray-900">{o.customer_name}</span>
              <span className="font-mono text-xs text-blue-700">{o.correlative}</span>
              <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", o.status === "finished" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600")}>
                {o.status === "finished" ? "Entregado" : "Cancelado"}
              </span>
              <span className="text-xs text-gray-500">{timeGT(o.finished_at)}</span>
              <span className="text-sm font-semibold">{formatCurrency(Number(o.total_price))}</span>
              <span className="ml-auto text-xs text-gray-600">
                {o.documents_deleted_at
                  ? `Documentos eliminados el ${dateGT(o.documents_deleted_at)}`
                  : o.keep_documents
                  ? "Conservación excepcional"
                  : o.purge_after ? `Se eliminará el ${dateGT(o.purge_after)}` : ""}
              </span>
            </div>
            {o.notes && <p className="border-b border-gray-100 px-4 py-1.5 text-xs text-gray-600">{o.notes}</p>}
            <DocumentList order={o} />
          </div>
        ))}
      </div>
    </div>
  );
}
