"use client";

import { useMemo, useState } from "react";
import { ArrowUp, X } from "lucide-react";
import { AgentStatusBar } from "@/components/admin/agent-status";
import { Button } from "@/components/ui/button";
import { AgentError, agentCall, useAgentState } from "@/lib/agent/client";
import { COLOR_LABELS, DUPLEX_LABELS, PAPER_LABELS, jobStatus, sizeLabel, timeGT } from "@/lib/agent/labels";
import type { AgentJob } from "@/lib/agent/types";
import { cn, formatCurrency } from "@/lib/utils";

type Tab = "pending" | "authorized" | "sent" | "printed" | "errors";

const TABS: [Tab, string][] = [
  ["pending", "Pendientes"],
  ["authorized", "Autorizados"],
  ["sent", "Enviados"],
  ["printed", "Impresos"],
  ["errors", "Errores"],
];

const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500";
const td = "px-3 py-2 align-top";

export function QueueClient() {
  const { state, error, role, refresh } = useAgentState();
  const [tab, setTab] = useState<Tab>("authorized");
  const [notice, setNotice] = useState<string | null>(null);

  const jobs = useMemo(() => state?.jobs ?? [], [state]);
  const withJobs = useMemo(() => new Set(jobs.filter((j) => j.status !== "cancelled").map((j) => j.document_id)), [jobs]);
  // Pendientes: documentos validados que aún no tienen autorización.
  const pendingDocs = useMemo(
    () => (state?.documents ?? []).filter((d) => d.status === "ready" && !withJobs.has(d.id)),
    [state, withJobs]
  );
  const orderName = (id: string | null) => state?.orders.find((o) => o.id === id)?.customer_name ?? "Sin cliente";

  const byTab: Record<Exclude<Tab, "pending">, AgentJob[]> = {
    // La cola real sale en este orden: prioridad, luego antigüedad.
    authorized: jobs.filter((j) => j.status === "ready" || j.status === "sending").sort((a, b) => b.priority - a.priority || a.seq - b.seq),
    sent: jobs.filter((j) => j.status === "sent" || j.status === "printing"),
    printed: jobs.filter((j) => j.status === "printed"),
    errors: jobs.filter((j) => j.status === "error" || j.status === "unknown" || j.status === "cancelled"),
  };
  const counts: Record<Tab, number> = {
    pending: pendingDocs.length,
    authorized: byTab.authorized.length,
    sent: byTab.sent.length,
    printed: byTab.printed.length,
    errors: byTab.errors.filter((j) => j.status !== "cancelled").length,
  };

  async function act(path: string, body?: unknown) {
    setNotice(null);
    try {
      await agentCall("POST", path, body);
      refresh();
    } catch (e) {
      setNotice((e as AgentError).message);
    }
  }

  return (
    <div>
      <AgentStatusBar state={state} error={error} role={role} />

      <div className="mb-3 flex flex-wrap gap-2">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn("rounded-full px-3 py-1 text-sm font-medium",
              tab === key ? "bg-blue-600 text-white" : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50",
              key === "errors" && counts.errors > 0 && tab !== key && "text-red-700 ring-red-200")}
          >
            {label} <span className="ml-1 opacity-70">{counts[key]}</span>
          </button>
        ))}
      </div>

      {notice && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          <p className="flex-1">{notice}</p>
          <button onClick={() => setNotice(null)} aria-label="Cerrar"><X className="h-4 w-4" /></button>
        </div>
      )}
      {tab === "sent" && (
        <p className="mb-3 text-xs text-gray-500">
          “Enviado” significa que Windows aceptó el trabajo, no que el papel salió. Confirme al retirar las hojas o marque el pedido como
          entregado en Recepción.
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        {tab === "pending" ? (
          <table className="w-full text-sm">
            <thead className="bg-gray-50"><tr>
              <th className={th}>Documento</th><th className={th}>Cliente</th><th className={th}>Detalle</th><th className={th}>Qué falta</th>
            </tr></thead>
            <tbody>
              {pendingDocs.length === 0 && <tr><td colSpan={4} className="px-4 py-12 text-center text-gray-400">No hay documentos esperando autorización.</td></tr>}
              {pendingDocs.map((d) => (
                <tr key={d.id} className="border-t border-gray-100">
                  <td className={td}><p className="font-medium text-gray-900">{d.original_name}</p><p className="text-xs text-gray-500">{timeGT(d.received_at)}</p></td>
                  <td className={td}>{orderName(d.order_id)}</td>
                  <td className={td}>{d.page_count} pág. · {sizeLabel(d)}</td>
                  <td className={cn(td, "text-xs")}>
                    {d.plan?.ok
                      ? <span className="text-emerald-700">Listo: falta autorizar en Recepción</span>
                      : <span className="text-amber-700">{d.plan?.problems.join(" ")}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50"><tr>
              <th className={th}>Documento</th><th className={th}>Cliente</th><th className={th}>Configuración</th>
              <th className={th}>Impresora</th><th className={th}>Estado</th><th className={th}>Precio</th><th className={th} />
            </tr></thead>
            <tbody>
              {byTab[tab].length === 0 && <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">Sin trabajos en esta vista.</td></tr>}
              {byTab[tab].map((j) => {
                const st = jobStatus(j);
                return (
                  <tr key={j.id} className="border-t border-gray-100">
                    <td className={td}>
                      <p className="font-medium text-gray-900">{j.original_name}</p>
                      <p className="text-xs text-gray-500">
                        {j.kind === "reprint" ? "Reimpresión · " : ""}{j.retry_of ? "Reenvío · " : ""}
                        {j.pages ? `págs. ${j.pages}` : `${j.page_count} pág.`} · {timeGT(j.created_at)}
                      </p>
                    </td>
                    <td className={td}>{j.customer_name ?? "—"}<p className="font-mono text-xs text-blue-700">{j.correlative}</p></td>
                    <td className={td}>
                      {j.copies} × {COLOR_LABELS[j.color_mode]} · {DUPLEX_LABELS[j.duplex]} · {PAPER_LABELS[j.paper_size]}
                      {j.scale_mode !== "noscale" && <span className="text-xs text-gray-500"> (ajustado)</span>}
                    </td>
                    <td className={td}>{j.printer_name}{j.tray && <p className="text-xs text-gray-500">{j.tray}</p>}</td>
                    <td className={td}>
                      <span className={cn("inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", st.color)}>{st.label}</span>
                      {j.priority > 0 && <span className="ml-1 text-xs font-semibold text-orange-700">Prioridad</span>}
                      {(j.hold_reason || j.error_message || j.spooler_status) && (
                        <p className={cn("mt-0.5 max-w-xs text-xs", j.error_message ? "text-red-600" : "text-gray-500")}>
                          {j.hold_reason ?? j.error_message ?? j.spooler_status}
                        </p>
                      )}
                    </td>
                    <td className={td}>{formatCurrency(j.price)}</td>
                    <td className={cn(td, "whitespace-nowrap text-right")}>
                      {j.status === "ready" && (
                        <>
                          <Button size="sm" variant="ghost" title="Imprimir antes que los demás" onClick={() => act(`/api/jobs/${j.id}/priority`, { priority: j.priority > 0 ? 0 : 5 })}>
                            <ArrowUp className="h-4 w-4" />{j.priority > 0 ? "Normal" : "Priorizar"}
                          </Button>
                          <Button size="sm" variant="ghost" className="text-red-600" onClick={() => act(`/api/jobs/${j.id}/cancel`)}>Cancelar</Button>
                        </>
                      )}
                      {(j.status === "sent" || j.status === "printing") && (
                        <>
                          <Button size="sm" onClick={() => act(`/api/jobs/${j.id}/confirm`)}>Confirmar impreso</Button>
                          <Button size="sm" variant="ghost" className="text-red-600" onClick={() => { if (confirm("¿Confirma que NO salió el papel?")) void act(`/api/jobs/${j.id}/not-printed`); }}>No salió</Button>
                        </>
                      )}
                      {j.status === "unknown" && (
                        <>
                          <Button size="sm" onClick={() => act(`/api/jobs/${j.id}/confirm`)}>Sí se imprimió</Button>
                          <Button size="sm" variant="outline" onClick={() => act(`/api/jobs/${j.id}/not-printed`)}>No se imprimió</Button>
                        </>
                      )}
                      {(j.status === "error" || j.status === "cancelled") && (
                        <Button size="sm" variant="outline" onClick={() => { if (confirm("Se enviará de nuevo a la impresora. ¿Continuar?")) void act(`/api/jobs/${j.id}/resend`); }}>
                          Reenviar
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
