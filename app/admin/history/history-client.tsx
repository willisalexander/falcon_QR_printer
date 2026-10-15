"use client";

import { useCallback, useEffect, useState } from "react";
import { Eye, Printer as PrinterIcon, Search } from "lucide-react";
import { AgentStatusBar } from "@/components/admin/agent-status";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { AgentError, agentCall, agentPdfUrl, useAgentState } from "@/lib/agent/client";
import { COLOR_LABELS, DUPLEX_LABELS, PAPER_LABELS, PAPER_OPTIONS, dateGT, docStatus, jobStatus, sizeLabel, timeGT } from "@/lib/agent/labels";
import type { AgentDoc, AgentJob, AgentPrinter, HistoryOrder } from "@/lib/agent/types";
import { cn, formatCurrency } from "@/lib/utils";

type Tab = "orders" | "audit" | "errors" | "deletions";

interface AuditEntry { id: string; at: string; actor: string | null; action: string; detail: Record<string, unknown> | null }
interface ErrorList {
  documents: { id: string; original_name: string; error_code: string; error_message: string; updated_at: string }[];
  jobs: { id: string; status: string; error_message: string | null; printer_name: string | null; updated_at: string; original_name: string }[];
}
interface Deletion { id: string; original_name: string | null; deleted_at: string; reason: string; files_removed: number }

const AUDIT_LABELS: Record<string, string> = {
  document_received: "Documento recibido",
  document_error: "Error en documento",
  document_retry: "Reintento de conversión",
  document_discarded: "Documento descartado",
  document_deleted: "Documento eliminado",
  documents_assigned: "Documentos asignados a pedido",
  documents_unassigned: "Documentos quitados de pedido",
  documents_updated: "Configuración modificada",
  order_updated: "Pedido modificado",
  order_finished: "Pedido entregado",
  order_cancelled: "Pedido cancelado",
  print_authorized: "Impresión autorizada",
  reprint_requested: "Reimpresión sin cobro",
  reprint_as_new_order: "Reimpresión cobrada (pedido nuevo)",
  print_sent: "Enviado a cola Windows",
  print_failed: "Fallo de impresión",
  print_unknown: "Envío incierto",
  job_cancelled: "Trabajo cancelado",
  job_confirmed: "Impresión confirmada",
  job_confirmed_spooler: "Impresión confirmada por la cola",
  job_marked_not_printed: "Marcado como no impreso",
  job_resent: "Trabajo reenviado",
  job_error: "Error de trabajo",
  job_priority: "Prioridad cambiada",
  job_unknown_after_restart: "Envío incierto tras reinicio",
  print_mode_changed: "Modo de impresión cambiado",
};

const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500";
const td = "px-3 py-2 align-top";
const field = "w-full rounded border border-gray-300 px-2 py-1.5 text-sm";

export function HistoryClient() {
  const { state, error, role } = useAgentState();
  const [tab, setTab] = useState<Tab>("orders");
  const [q, setQ] = useState("");
  const [orders, setOrders] = useState<HistoryOrder[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [errors, setErrors] = useState<ErrorList | null>(null);
  const [deletions, setDeletions] = useState<Deletion[]>([]);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [reprint, setReprint] = useState<AgentDoc | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      if (tab === "orders") setOrders((await agentCall<{ orders: HistoryOrder[] }>("GET", `/api/history/orders?q=${encodeURIComponent(q)}`)).orders);
      if (tab === "audit") setAudit((await agentCall<{ entries: AuditEntry[] }>("GET", "/api/history/audit")).entries);
      if (tab === "errors") setErrors(await agentCall<ErrorList>("GET", "/api/history/errors"));
      if (tab === "deletions") setDeletions((await agentCall<{ deletions: Deletion[] }>("GET", "/api/history/deletions")).deletions);
    } catch (e) {
      setNotice({ kind: "error", text: (e as Error).message });
    }
  }, [tab, q]);

  // Se recarga al cambiar de pestaña, al buscar y cuando el agente avisa de cambios.
  const version = state?.agent.version;
  useEffect(() => {
    const timer = setTimeout(() => void load(), 200);
    return () => clearTimeout(timer);
  }, [load, version]);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  async function toggleKeep(order: HistoryOrder) {
    try {
      await agentCall("POST", `/api/orders/${order.id}/update`, { keep_documents: !order.keep_documents });
      await load();
    } catch (e) {
      setNotice({ kind: "error", text: (e as Error).message });
    }
  }

  return (
    <div>
      <AgentStatusBar state={state} error={error} role={role} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {([["orders", "Pedidos anteriores"], ["audit", "Auditoría"], ["errors", "Errores"], ["deletions", "Documentos eliminados"]] as [Tab, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={cn("rounded-full px-3 py-1 text-sm font-medium", tab === key ? "bg-blue-600 text-white" : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50")}>
            {label}
          </button>
        ))}
      </div>

      {notice && (
        <p className={cn("mb-3 rounded-lg border px-4 py-2 text-sm", notice.kind === "ok" ? "border-green-200 bg-green-50 text-green-700" : "border-red-200 bg-red-50 text-red-700")}>
          {notice.text}
        </p>
      )}

      {tab === "orders" && (
        <div className="mb-4 rounded-xl border border-gray-200 bg-white p-3">
          {/* Ícono, campo y botón van uno al lado del otro: nada se superpone al texto. */}
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
            {q && (
              <button
                onClick={() => setQ("")}
                className="flex-shrink-0 rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
              >
                Limpiar
              </button>
            )}
          </div>
          <p className="mt-2 text-xs text-gray-500">
            {q.trim()
              ? `${orders.length === 50 ? "50 o más" : orders.length} pedido(s) coinciden con “${q.trim()}”. No distingue mayúsculas ni acentos.`
              : "Se muestran los pedidos cerrados más recientes. Escriba para buscar, por ejemplo: maria, ARR-20261013 o contrato."}
          </p>
        </div>
      )}

      {tab === "orders" && (
        <div className="space-y-3">
          {orders.length === 0 && <p className="rounded-xl border border-gray-200 bg-white px-4 py-12 text-center text-sm text-gray-400">No hay pedidos cerrados que coincidan.</p>}
          {orders.map((o) => (
            <div key={o.id} className="rounded-xl border border-gray-200 bg-white">
              <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-2.5">
                <span className="font-semibold text-gray-900">{o.customer_name}</span>
                <span className="font-mono text-xs text-blue-700">{o.correlative}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", o.status === "finished" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600")}>
                  {o.status === "finished" ? "Entregado" : "Cancelado"}
                </span>
                <span className="text-xs text-gray-500">{timeGT(o.finished_at)}</span>
                <span className="text-sm font-semibold">{formatCurrency(o.total_price)}</span>
                <span className="ml-auto text-xs text-gray-600">
                  {o.documents_deleted_at
                    ? `Documentos eliminados el ${dateGT(o.documents_deleted_at)}`
                    : o.keep_documents
                    ? "Conservación excepcional: no se eliminará"
                    : `Se eliminará el ${dateGT(o.purge_after)}`}
                </span>
                {!o.documents_deleted_at && (
                  <Button size="sm" variant="outline" onClick={() => toggleKeep(o)}>
                    {o.keep_documents ? "Quitar excepción" : "Conservar"}
                  </Button>
                )}
              </div>
              {o.notes && <p className="border-b border-gray-100 px-4 py-1.5 text-xs text-gray-600">{o.notes}</p>}
              <table className="w-full text-sm">
                <tbody>
                  {o.documents.map((d) => {
                    const jobs = o.jobs.filter((j) => j.document_id === d.id);
                    const last = jobs.at(-1);
                    const st = docStatus(d, last);
                    return (
                      <tr key={d.id} className="border-b border-gray-50 last:border-0">
                        <td className={td}>
                          <p className="font-medium text-gray-900">{d.original_name}</p>
                          <p className="text-xs text-gray-500">{d.page_count ?? "?"} pág. · {sizeLabel(d)}</p>
                        </td>
                        <td className={cn(td, "text-xs text-gray-600")}>
                          {last ? `${last.copies} × ${COLOR_LABELS[last.color_mode]} · ${DUPLEX_LABELS[last.duplex]} · ${PAPER_LABELS[last.paper_size]} · ${last.printer_name}` : "Sin impresiones"}
                          {jobs.length > 1 && <span className="ml-1 text-gray-400">({jobs.length} trabajos)</span>}
                        </td>
                        <td className={td}><span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", st.color)}>{st.label}</span></td>
                        <td className={cn(td, "whitespace-nowrap text-right")}>
                          {d.pdf_available ? (
                            <>
                              <Button size="sm" variant="ghost" onClick={async () => { try { setPreviewUrl(await agentPdfUrl(d.id)); } catch (e) { setNotice({ kind: "error", text: (e as Error).message }); } }}>
                                <Eye className="h-4 w-4" />Ver
                              </Button>
                              <Button size="sm" onClick={() => setReprint(d)}><PrinterIcon className="h-4 w-4" />Reimprimir</Button>
                            </>
                          ) : (
                            <span className="text-xs text-gray-400">PDF no disponible (eliminado)</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {tab === "audit" && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50"><tr><th className={th}>Fecha</th><th className={th}>Usuario</th><th className={th}>Acción</th><th className={th}>Detalle</th></tr></thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.id} className="border-t border-gray-100">
                  <td className={cn(td, "whitespace-nowrap text-xs text-gray-500")}>{timeGT(a.at)}</td>
                  <td className={td}>{a.actor}</td>
                  <td className={td}>{AUDIT_LABELS[a.action] ?? a.action}</td>
                  <td className={cn(td, "text-xs text-gray-500")}>
                    {a.detail ? Object.entries(a.detail).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`).join(" · ") : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "errors" && errors && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50"><tr><th className={th}>Fecha</th><th className={th}>Tipo</th><th className={th}>Documento</th><th className={th}>Error</th></tr></thead>
            <tbody>
              {errors.documents.length + errors.jobs.length === 0 && <tr><td colSpan={4} className="px-4 py-12 text-center text-gray-400">Sin errores registrados.</td></tr>}
              {errors.jobs.map((j) => (
                <tr key={j.id} className="border-t border-gray-100">
                  <td className={cn(td, "whitespace-nowrap text-xs text-gray-500")}>{timeGT(j.updated_at)}</td>
                  <td className={td}>{jobStatus({ status: j.status as AgentJob["status"], hold_reason: null }).label} · {j.printer_name}</td>
                  <td className={td}>{j.original_name}</td>
                  <td className={cn(td, "text-xs text-red-600")}>{j.error_message}</td>
                </tr>
              ))}
              {errors.documents.map((d) => (
                <tr key={d.id} className="border-t border-gray-100">
                  <td className={cn(td, "whitespace-nowrap text-xs text-gray-500")}>{timeGT(d.updated_at)}</td>
                  <td className={td}>Conversión / validación</td>
                  <td className={td}>{d.original_name}</td>
                  <td className={cn(td, "text-xs text-red-600")}>[{d.error_code}] {d.error_message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "deletions" && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50"><tr><th className={th}>Eliminado</th><th className={th}>Documento</th><th className={th}>Motivo</th><th className={th}>Archivos</th></tr></thead>
            <tbody>
              {deletions.length === 0 && <tr><td colSpan={4} className="px-4 py-12 text-center text-gray-400">Aún no se ha eliminado ningún documento.</td></tr>}
              {deletions.map((d) => (
                <tr key={d.id} className="border-t border-gray-100">
                  <td className={cn(td, "whitespace-nowrap text-xs text-gray-500")}>{timeGT(d.deleted_at)}</td>
                  <td className={td}>{d.original_name}</td>
                  <td className={cn(td, "text-xs text-gray-600")}>{d.reason}</td>
                  <td className={td}>{d.files_removed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!reprint} onClose={() => setReprint(null)} title="Reimprimir desde esta computadora" className="max-w-lg">
        {reprint && (
          <ReprintForm
            doc={reprint}
            printers={(state?.printers ?? []).filter((p) => p.is_active)}
            onDone={(text) => { setReprint(null); setNotice({ kind: "ok", text }); }}
          />
        )}
      </Modal>

      <Modal open={!!previewUrl} onClose={() => setPreviewUrl(null)} title="Vista previa" className="max-w-4xl">
        {previewUrl && <iframe title="Vista previa del PDF" src={previewUrl} className="h-[70vh] w-full" />}
      </Modal>
    </div>
  );
}

function ReprintForm({ doc, printers, onDone }: { doc: AgentDoc; printers: AgentPrinter[]; onDone: (text: string) => void }) {
  const [previous, setPrevious] = useState<AgentJob | null>(null);
  const [copies, setCopies] = useState(1);
  const [color, setColor] = useState<"bw" | "color">("bw");
  const [duplex, setDuplex] = useState<"simplex" | "long" | "short">("simplex");
  const [paper, setPaper] = useState("");
  const [scale, setScale] = useState("");
  const [printerId, setPrinterId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ text: string; items?: string[] } | null>(null);
  // Por defecto es una corrección sin cobro; cobrar es para otra persona que pide el mismo documento.
  const [charge, setCharge] = useState(false);
  const [customer, setCustomer] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);

  useEffect(() => {
    const q = customer.trim();
    if (!charge || q.length < 2) return setSuggestions([]);
    const timer = setTimeout(() => {
      agentCall<{ customers: { name: string }[] }>("GET", `/api/customers?q=${encodeURIComponent(q)}`)
        .then((r) => setSuggestions(r.customers.map((c) => c.name)))
        .catch(() => {});
    }, 150);
    return () => clearTimeout(timer);
  }, [customer, charge]);

  // Parte de la configuración con la que se imprimió la última vez.
  useEffect(() => {
    agentCall<{ jobs: AgentJob[] }>("GET", `/api/documents/${doc.id}`)
      .then(({ jobs }) => {
        const last = jobs[0];
        if (!last) return;
        setPrevious(last);
        setCopies(last.copies);
        setColor(last.color_mode);
        setDuplex(last.duplex);
        setPrinterId(last.printer_id ?? "");
        if (doc.paper_size) setPaper(doc.paper_size);
        if (doc.scale_mode && doc.scale_mode !== "noscale") setScale(doc.scale_mode);
      })
      .catch((e) => setErr({ text: (e as Error).message }));
  }, [doc]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (charge && customer.trim().length < 2) {
      setErr({ text: "Escriba el nombre del cliente que pide la copia." });
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await agentCall<{ orderId?: string; authorized?: boolean; problems?: string[] }>("POST", `/api/documents/${doc.id}/reprint`, {
        copies, color_mode: color, duplex,
        paper_size: paper || null, scale_mode: scale || null, printer_id: printerId || null,
        ...(charge && { charge: true, customerName: customer }),
      });
      if (charge && !r.orderId) {
        // Un agente que no se reinició tras actualizar ignora el cobro y reimprime dentro del pedido original.
        setErr({
          text: "El agente local está desactualizado: se reimprimió SIN cobro y no se creó el pedido nuevo. " +
            "Reinicie el agente (Ctrl + C y npm start) y vuelva a intentarlo.",
        });
      } else if (!charge) {
        onDone(`Reimpresión de "${doc.original_name}" enviada a la cola (sin cobro).`);
      } else if (r.authorized) {
        onDone(`Pedido nuevo creado para ${customer.trim()} y enviado a imprimir. Está en Recepción: márquelo Entregado al cobrar.`);
      } else {
        onDone(`Pedido nuevo creado para ${customer.trim()}, pero no se pudo enviar a imprimir: ${(r.problems ?? []).join(" ")} Revíselo en Recepción.`);
      }
    } catch (e) {
      const a = e as AgentError;
      setErr({ text: a.message, items: a.problems });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-sm font-medium text-gray-900">{doc.original_name}</p>
      <p className="text-xs text-gray-500">
        {doc.page_count} pág. · {sizeLabel(doc)}
        {previous && ` · Última vez: ${previous.copies} × ${COLOR_LABELS[previous.color_mode]}, ${DUPLEX_LABELS[previous.duplex]}, ${previous.printer_name} (${timeGT(previous.sent_at ?? previous.created_at)})`}
      </p>
      <fieldset className="space-y-2 rounded-lg border border-gray-200 p-3">
        <legend className="px-1 text-xs font-medium text-gray-600">Tipo de reimpresión</legend>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="charge" className="mt-1" checked={!charge} onChange={() => setCharge(false)} />
          <span>
            <span className="font-medium text-gray-900">Sin cobro</span>
            <span className="block text-xs text-gray-500">Corrección para el mismo cliente. Queda en el pedido original y no suma a ingresos.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="charge" className="mt-1" checked={charge} onChange={() => setCharge(true)} />
          <span>
            <span className="font-medium text-gray-900">Cobrar como pedido nuevo</span>
            <span className="block text-xs text-gray-500">Otra persona pide el mismo documento. Crea un pedido en Recepción que suma al marcarlo Entregado.</span>
          </span>
        </label>
        {charge && (
          <>
            <input
              autoFocus
              list="clientes-reimpresion"
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
              placeholder="Nombre del cliente"
              aria-label="Nombre del cliente"
              maxLength={100}
              autoComplete="off"
              className={field}
            />
            <datalist id="clientes-reimpresion">{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
          </>
        )}
      </fieldset>
      <div className="grid grid-cols-3 gap-3">
        <label className="text-xs text-gray-600">Copias
          <input type="number" min={1} max={999} value={copies} onChange={(e) => setCopies(parseInt(e.target.value, 10) || 1)} className={field} />
        </label>
        <label className="text-xs text-gray-600">Color
          <select value={color} onChange={(e) => setColor(e.target.value as "bw" | "color")} className={field}>
            <option value="bw">Blanco y negro</option><option value="color">Color</option>
          </select>
        </label>
        <label className="text-xs text-gray-600">Caras
          <select value={duplex} onChange={(e) => setDuplex(e.target.value as "simplex" | "long" | "short")} className={field}>
            {Object.entries(DUPLEX_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs text-gray-600">Papel
          <select value={paper} onChange={(e) => setPaper(e.target.value)} className={field}>
            <option value="">Según documento</option>
            {PAPER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="text-xs text-gray-600">Ajuste (si cambia el papel)
          <select value={scale} onChange={(e) => setScale(e.target.value)} className={field}>
            <option value="">Sin escalar</option><option value="fit">Ajustar al papel</option><option value="shrink">Reducir si no cabe</option>
          </select>
        </label>
      </div>
      <label className="block text-xs text-gray-600">Impresora
        <select value={printerId} onChange={(e) => setPrinterId(e.target.value)} className={field}>
          <option value="">Automática (según reglas)</option>
          {printers.map((p) => <option key={p.id} value={p.id}>{p.name}{p.available ? "" : " (no disponible)"}</option>)}
        </select>
      </label>
      {err && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <p>{err.text}</p>
          {err.items && <ul className="mt-1 list-disc pl-5 text-xs">{err.items.map((i) => <li key={i}>{i}</li>)}</ul>}
        </div>
      )}
      <div className="flex justify-end pt-1">
        <Button type="submit" loading={busy}>
          <PrinterIcon className="h-4 w-4" />
          {charge ? "Crear pedido e imprimir" : "Reimprimir sin cobro"}
        </Button>
      </div>
    </form>
  );
}
