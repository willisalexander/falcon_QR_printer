"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Eye, FileText, Printer as PrinterIcon, RotateCcw, Trash2, X } from "lucide-react";
import { AgentStatusBar } from "@/components/admin/agent-status";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { PdfPreview } from "@/components/admin/pdf-preview";
import { RemoteReception } from "@/components/admin/remote-mode";
import { useRemoteMode } from "@/lib/agent/use-remote-mode";
import { AgentError, agentCall, agentPdfUrl, useAgentState } from "@/lib/agent/client";
import { DUPLEX_LABELS, PAPER_OPTIONS, SCALE_LABELS, docStatus, sizeLabel, timeGT } from "@/lib/agent/labels";
import type { AgentDoc, AgentJob, AgentOrder } from "@/lib/agent/types";
import { cn, formatCurrency } from "@/lib/utils";

type Filter = "all" | "unidentified" | "converting" | "ready" | "error";
type Patch = Partial<Pick<AgentDoc, "copies" | "color_mode" | "duplex" | "paper_size" | "scale_mode" | "mixed_strategy" | "printer_id" | "notes">>;

const DEFAULTS: Patch = { copies: 1, color_mode: "bw", duplex: "simplex" };
const cell = "px-2 py-1.5 align-top";
const input = "w-full rounded border border-gray-300 bg-white px-1.5 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
const isTyping = (el: EventTarget | null) => el instanceof HTMLElement && ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName);

export function ReceptionClient() {
  const { state, error, role, refresh } = useAgentState();
  const remote = useRemoteMode(state, error);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [preview, setPreview] = useState<{ id: string; url: string; name: string } | null>(null);
  const [notice, setNotice] = useState<{ kind: "error" | "ok"; text: string; items?: string[] } | null>(null);
  // Ventana emergente del cliente: documentos a los que se aplicará y nombre actual (si ya tienen).
  const [clientModal, setClientModal] = useState<{ ids: string[]; current: string } | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const anchor = useRef<string | null>(null);

  const docs = useMemo(() => state?.documents ?? [], [state]);
  const lastJob = useMemo(() => {
    const map = new Map<string, AgentJob>();
    for (const j of state?.jobs ?? []) if (!map.has(j.document_id)) map.set(j.document_id, j); // vienen del más nuevo al más viejo
    return map;
  }, [state]);

  const counts = useMemo(() => ({
    all: docs.length,
    unidentified: docs.filter((d) => d.status === "ready" && !d.order_id).length,
    converting: docs.filter((d) => d.status === "queued" || d.status === "converting").length,
    ready: docs.filter((d) => d.status === "ready" && d.order_id).length,
    error: docs.filter((d) => d.status === "error").length,
  }), [docs]);

  // Sin cliente primero; después cada pedido abierto con sus documentos juntos.
  const groups = useMemo(() => {
    const match = (d: AgentDoc) =>
      filter === "all" ||
      (filter === "unidentified" && d.status === "ready" && !d.order_id) ||
      (filter === "converting" && (d.status === "queued" || d.status === "converting")) ||
      (filter === "ready" && d.status === "ready" && !!d.order_id) ||
      (filter === "error" && d.status === "error");
    const shown = docs.filter(match);
    const out: { order: AgentOrder | null; docs: AgentDoc[] }[] = [];
    const loose = shown.filter((d) => !d.order_id);
    if (loose.length) out.push({ order: null, docs: loose });
    for (const order of state?.orders ?? []) {
      const own = shown.filter((d) => d.order_id === order.id);
      if (own.length) out.push({ order, docs: own });
    }
    return out;
  }, [docs, filter, state]);
  const visible = useMemo(() => groups.flatMap((g) => g.docs), [groups]);

  // La selección solo conserva documentos que siguen en pantalla.
  useEffect(() => {
    const ids = new Set(visible.map((d) => d.id));
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
    if (cursor && !ids.has(cursor)) setCursor(visible[0]?.id ?? null);
  }, [visible, cursor]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setNotice(null);
    try {
      await fn();
      refresh();
    } catch (e) {
      const err = e as AgentError;
      setNotice({ kind: "error", text: err.message, items: err.problems });
    }
  }, [refresh]);

  const targets = useCallback(() => (selected.size ? [...selected] : cursor ? [cursor] : []), [selected, cursor]);
  const nameOf = (id: string) => docs.find((d) => d.id === id)?.original_name ?? id;

  const patch = (ids: string[], p: Patch) => ids.length && run(() => agentCall("POST", "/api/documents/update", { ids, patch: p }));

  /** Abre la ventana del cliente para la selección; si no hay selección, para el documento indicado. */
  function askClient(docId?: string) {
    const ids = [...new Set([...selected, ...(docId ? [docId] : selected.size ? [] : cursor ? [cursor] : [])])];
    if (!ids.length) return;
    const orderIds = new Set(ids.map((id) => docs.find((d) => d.id === id)?.order_id ?? null));
    const only = orderIds.size === 1 ? [...orderIds][0] : null;
    setClientModal({ ids, current: state?.orders.find((o) => o.id === only)?.customer_name ?? "" });
  }

  function closeClient() {
    setClientModal(null);
    tableRef.current?.focus();
  }

  function assign(ids: string[], name: string, newOrder: boolean) {
    closeClient();
    void run(async () => {
      await agentCall("POST", "/api/documents/assign", { ids, customerName: name, newOrder });
      setSelected(new Set());
    });
  }

  function unassign(ids: string[]) {
    closeClient();
    void run(async () => {
      await agentCall("POST", "/api/documents/unassign", { ids });
      setSelected(new Set());
    });
  }

  function reportAuthorize(results: { id: string; ok: boolean; problems?: string[] }[]) {
    const failed = results.filter((r) => !r.ok);
    const sent = results.length - failed.length;
    if (failed.length) {
      setNotice({
        kind: "error",
        text: `${sent} documento(s) enviados a la cola. ${failed.length} no se autorizaron:`,
        items: failed.map((r) => `${nameOf(r.id)}: ${(r.problems ?? []).join(" ")}`),
      });
    } else {
      setNotice({ kind: "ok", text: `${sent} documento(s) enviados a la cola de impresión.` });
      setSelected(new Set());
    }
  }

  const authorize = (ids: string[]) => ids.length && run(async () => {
    const r = await agentCall<{ results: { id: string; ok: boolean; problems?: string[] }[] }>("POST", "/api/documents/authorize", { ids });
    reportAuthorize(r.results);
  });

  function discard(ids: string[]) {
    if (!ids.length || !confirm(`¿Descartar ${ids.length} documento(s)? Dejarán de aparecer en la bandeja.`)) return;
    void run(() => agentCall("POST", "/api/documents/discard", { ids }));
  }

  async function openPreview(doc: AgentDoc) {
    if (!doc.has_pdf) return;
    try {
      const url = await agentPdfUrl(doc.id);
      setPreview({ id: doc.id, url, name: doc.original_name });
    } catch (e) {
      setNotice({ kind: "error", text: (e as Error).message });
    }
  }

  function toggle(id: string, range: boolean) {
    setCursor(id);
    setSelected((prev) => {
      const next = new Set(prev);
      if (range && anchor.current) {
        const a = visible.findIndex((d) => d.id === anchor.current);
        const b = visible.findIndex((d) => d.id === id);
        if (a >= 0 && b >= 0) for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(visible[i].id);
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (!range) anchor.current = id;
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (isTyping(e.target)) {
      if (e.key === "Escape") tableRef.current?.focus();
      return;
    }
    const idx = visible.findIndex((d) => d.id === cursor);
    const move = (delta: number) => {
      const next = visible[Math.max(0, Math.min(visible.length - 1, (idx < 0 ? 0 : idx) + delta))];
      if (!next) return;
      setCursor(next.id);
      if (e.shiftKey) setSelected((prev) => new Set(prev).add(next.id).add(cursor ?? next.id));
      document.getElementById(`doc-${next.id}`)?.scrollIntoView({ block: "nearest" });
    };
    const ids = targets();
    const key = e.key.toLowerCase();
    if (e.key === "ArrowDown") move(1);
    else if (e.key === "ArrowUp") move(-1);
    else if (e.key === " " && cursor) toggle(cursor, false);
    else if (key === "a" && (e.ctrlKey || e.metaKey)) setSelected(new Set(visible.map((d) => d.id)));
    else if (e.ctrlKey || e.metaKey || e.altKey) return;
    else if (e.key === "Escape") { setSelected(new Set()); setPreview(null); }
    else if (key === "c") askClient();
    else if (/^[1-9]$/.test(e.key)) void patch(ids, { copies: Number(e.key) });
    else if (key === "b") void patch(ids, { color_mode: "bw" });
    else if (key === "k") void patch(ids, { color_mode: "color" });
    else if (key === "s") void patch(ids, { duplex: "simplex" });
    else if (key === "d") void patch(ids, { duplex: "long" });
    else if (key === "x") void patch(ids, DEFAULTS);
    else if (key === "v") { const d = visible[idx]; if (d) void openPreview(d); }
    else if (e.key === "Enter") void authorize(ids);
    else return;
    e.preventDefault();
  }

  const printers = (state?.printers ?? []).filter((p) => p.is_active);

  // Computadora sin agente: solo ver pedidos y entregarlos o cancelarlos.
  if (remote) return <RemoteReception />;

  return (
    <div className="flex h-full flex-col">
      <AgentStatusBar state={state} error={error} role={role} />

      {/* Filtros de la bandeja */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {([
          ["all", "Todos"], ["unidentified", "Sin cliente"], ["converting", "En conversión"], ["ready", "Listos"], ["error", "Con error"],
        ] as [Filter, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={cn("rounded-full px-3 py-1 text-sm font-medium",
              filter === key ? "bg-blue-600 text-white" : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50",
              key === "error" && counts.error > 0 && filter !== key && "text-red-700 ring-red-200")}
          >
            {label} <span className="ml-1 opacity-70">{counts[key]}</span>
          </button>
        ))}
        <span className="ml-auto hidden text-xs text-gray-400 xl:block">
          ↑↓ mover · Espacio seleccionar · C cliente · 1-9 copias · B b/n · K color · S simple · D dúplex · X valores comunes · V ver · Enter autorizar
        </span>
      </div>

      {notice && (
        <div className={cn("mb-3 flex items-start gap-2 rounded-lg border px-4 py-2 text-sm",
          notice.kind === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-green-200 bg-green-50 text-green-700")}>
          <div className="flex-1">
            <p>{notice.text}</p>
            {notice.items && <ul className="mt-1 list-disc pl-5 text-xs">{notice.items.map((i) => <li key={i}>{i}</li>)}</ul>}
          </div>
          <button onClick={() => setNotice(null)} aria-label="Cerrar"><X className="h-4 w-4" /></button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-4">
        <div
          ref={tableRef}
          tabIndex={0}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 overflow-auto rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"
        >
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="w-8 px-2 py-2">
                  <input
                    type="checkbox"
                    aria-label="Seleccionar todos"
                    checked={visible.length > 0 && selected.size === visible.length}
                    onChange={(e) => setSelected(e.target.checked ? new Set(visible.map((d) => d.id)) : new Set())}
                  />
                </th>
                <th className="px-2 py-2">Documento</th>
                <th className="px-2 py-2">Estado</th>
                <th className="w-16 px-2 py-2">Copias</th>
                <th className="w-24 px-2 py-2">Color</th>
                <th className="w-28 px-2 py-2">Caras</th>
                <th className="w-44 px-2 py-2">Papel</th>
                <th className="w-44 px-2 py-2">Impresora</th>
                <th className="w-24 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-16 text-center text-gray-400">
                    {state ? "No hay documentos en esta vista. Los archivos descargados en la carpeta aparecerán aquí solos." : "Cargando…"}
                  </td>
                </tr>
              )}
              {groups.map((group) => (
                <Fragment key={group.order?.id ?? "loose"}>
                  <tr className={cn("border-y border-gray-200", group.order ? "bg-blue-50/60" : "bg-yellow-50")}>
                    <td colSpan={9} className="px-3 py-2">
                      {group.order ? (
                        <OrderHeader order={group.order} run={run} />
                      ) : (
                        <span className="text-sm font-semibold text-yellow-900">
                          Pendientes de identificación — haga clic en un documento para escribir el nombre del cliente
                        </span>
                      )}
                    </td>
                  </tr>
                  {group.docs.map((doc) => {
                    const job = lastJob.get(doc.id);
                    const st = docStatus(doc, job);
                    const ready = doc.status === "ready";
                    const detected = doc.size_class;
                    const needsScale = ready && detected !== "mixed" && (detected === "custom" || (!!doc.paper_size && doc.paper_size !== detected));
                    const autoPrinter = doc.plan?.parts.length ? [...new Set(doc.plan.parts.map((p) => p.printerName))].join(" + ") : "—";
                    return (
                      <tr
                        key={doc.id}
                        id={`doc-${doc.id}`}
                        onClick={(e) => {
                          if (isTyping(e.target) || (e.target as HTMLElement).closest("button")) return;
                          setCursor(doc.id);
                          // Un documento sin cliente pide el nombre al seleccionarlo.
                          if (!doc.order_id) askClient(doc.id);
                        }}
                        className={cn("border-b border-gray-100", selected.has(doc.id) && "bg-blue-50", cursor === doc.id && "outline outline-2 -outline-offset-2 outline-blue-400")}
                      >
                        <td className={cell}>
                          <input type="checkbox" aria-label={`Seleccionar ${doc.original_name}`} checked={selected.has(doc.id)}
                            onChange={() => {}} onClick={(e) => toggle(doc.id, e.shiftKey)} />
                        </td>
                        <td className={cell}>
                          <div className="flex items-start gap-2">
                            <FileText className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
                            <div className="min-w-0">
                              <p className="truncate font-medium text-gray-900" title={doc.original_name}>{doc.original_name}</p>
                              <p className="text-xs text-gray-500">
                                {timeGT(doc.received_at)}
                                {doc.page_count ? ` · ${doc.page_count} pág. · ${sizeLabel(doc)}` : ""}
                                {doc.orientation === "landscape" ? " · horizontal" : ""}
                              </p>
                              {doc.status === "error" && <p className="mt-0.5 text-xs text-red-600">{doc.error_message}</p>}
                              {ready && doc.order_id && !job && doc.plan?.problems.map((p) => (
                                <p key={p} className="mt-0.5 text-xs text-amber-700">{p}</p>
                              ))}
                              {ready && !doc.review_ack && doc.plan?.warnings.map((w) => (
                                <p key={w} className="mt-0.5 flex items-center gap-1 text-xs text-orange-700"><AlertTriangle className="h-3 w-3" />{w}</p>
                              ))}
                              {job?.hold_reason && <p className="mt-0.5 text-xs text-yellow-800">{job.hold_reason}</p>}
                              {job && (job.status === "error" || job.status === "unknown") && <p className="mt-0.5 text-xs text-red-600">{job.error_message}</p>}
                            </div>
                          </div>
                        </td>
                        <td className={cell}>
                          <span className={cn("inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", st.color)}>{st.label}</span>
                        </td>
                        <td className={cell}>
                          <input type="number" min={1} max={999} disabled={!ready} className={input} aria-label="Copias"
                            key={`${doc.id}-${doc.copies}`} defaultValue={doc.copies ?? ""}
                            onBlur={(e) => { const n = parseInt(e.target.value, 10); if (n >= 1 && n !== doc.copies) void patch([doc.id], { copies: n }); }}
                            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                        </td>
                        <td className={cell}>
                          <select disabled={!ready} className={input} aria-label="Color" value={doc.color_mode ?? ""}
                            onChange={(e) => patch([doc.id], { color_mode: (e.target.value || null) as AgentDoc["color_mode"] })}>
                            <option value="">—</option>
                            <option value="bw">B/N</option>
                            <option value="color">Color</option>
                          </select>
                        </td>
                        <td className={cell}>
                          <select disabled={!ready} className={input} aria-label="Caras" value={doc.duplex ?? ""}
                            onChange={(e) => patch([doc.id], { duplex: (e.target.value || null) as AgentDoc["duplex"] })}>
                            <option value="">—</option>
                            {Object.entries(DUPLEX_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </select>
                        </td>
                        <td className={cell}>
                          {ready && detected === "mixed" && (
                            <select className={cn(input, "mb-1")} aria-label="Páginas mixtas" value={doc.mixed_strategy ?? ""}
                              onChange={(e) => patch([doc.id], { mixed_strategy: (e.target.value || null) as AgentDoc["mixed_strategy"] })}>
                              <option value="">Tamaños mixtos: revisar</option>
                              <option value="split">Separar por tamaño</option>
                              <option value="fit">Ajustar a un tamaño</option>
                            </select>
                          )}
                          {(detected !== "mixed" || doc.mixed_strategy === "fit") && (
                            <select disabled={!ready} className={input} aria-label="Papel" value={doc.paper_size ?? ""}
                              onChange={(e) => patch([doc.id], { paper_size: (e.target.value || null) as AgentDoc["paper_size"] })}>
                              <option value="">{detected && detected !== "custom" && detected !== "mixed" ? "Según documento" : "Elegir papel…"}</option>
                              {PAPER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                          )}
                          {needsScale && (
                            <select className={cn(input, "mt-1")} aria-label="Regla de ajuste" value={doc.scale_mode && doc.scale_mode !== "noscale" ? doc.scale_mode : ""}
                              onChange={(e) => patch([doc.id], { scale_mode: (e.target.value || null) as AgentDoc["scale_mode"] })}>
                              <option value="">Regla de ajuste…</option>
                              <option value="fit">{SCALE_LABELS.fit}</option>
                              <option value="shrink">{SCALE_LABELS.shrink}</option>
                            </select>
                          )}
                        </td>
                        <td className={cell}>
                          <select disabled={!ready} className={input} aria-label="Impresora" value={doc.printer_id ?? ""}
                            onChange={(e) => patch([doc.id], { printer_id: e.target.value || null })}>
                            <option value="">Auto: {autoPrinter}</option>
                            {printers.map((p) => <option key={p.id} value={p.id}>{p.name}{p.available ? "" : " (no disponible)"}</option>)}
                          </select>
                        </td>
                        <td className={cn(cell, "whitespace-nowrap text-right")}>
                          {doc.has_pdf && (
                            <button title="Vista previa del PDF (V)" onClick={() => openPreview(doc)} className="rounded p-1 text-gray-500 hover:bg-gray-100">
                              <Eye className="h-4 w-4" />
                            </button>
                          )}
                          {doc.status === "error" && (
                            <button title="Reintentar conversión" onClick={() => run(() => agentCall("POST", `/api/documents/${doc.id}/retry`))} className="rounded p-1 text-gray-500 hover:bg-gray-100">
                              <RotateCcw className="h-4 w-4" />
                            </button>
                          )}
                          {ready && doc.order_id && !job && (
                            <button title="Autorizar impresión" onClick={() => authorize([doc.id])} className="rounded p-1 text-blue-600 hover:bg-blue-50">
                              <PrinterIcon className="h-4 w-4" />
                            </button>
                          )}
                          {(!job || job.status === "cancelled" || job.status === "error") && (
                            <button title="Descartar documento" onClick={() => discard(selected.has(doc.id) ? [...selected] : [doc.id])} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {preview && (
          <div className="flex w-[42%] flex-shrink-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
              <p className="truncate text-sm font-medium text-gray-800">Así se imprimirá: {preview.name}</p>
              <button onClick={() => setPreview(null)} aria-label="Cerrar vista previa"><X className="h-4 w-4 text-gray-500" /></button>
            </div>
            <PdfPreview url={preview.url} name={preview.name} />
          </div>
        )}
      </div>

      <Modal open={!!clientModal} onClose={closeClient} title="Nombre del cliente">
        {clientModal && (
          <ClientForm
            count={clientModal.ids.length}
            current={clientModal.current}
            onSubmit={(name, newOrder) => assign(clientModal.ids, name, newOrder)}
            onUnassign={clientModal.current ? () => unassign(clientModal.ids) : undefined}
          />
        )}
      </Modal>
    </div>
  );
}

function ClientForm({ count, current, onSubmit, onUnassign }: {
  count: number;
  current: string;
  onSubmit: (name: string, newOrder: boolean) => void;
  onUnassign?: () => void;
}) {
  const [name, setName] = useState(current);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  useEffect(() => {
    const q = name.trim();
    if (q.length < 2) return setSuggestions([]);
    const timer = setTimeout(() => {
      agentCall<{ customers: { name: string }[] }>("GET", `/api/customers?q=${encodeURIComponent(q)}`)
        .then((r) => setSuggestions(r.customers.map((c) => c.name)))
        .catch(() => {});
    }, 150);
    return () => clearTimeout(timer);
  }, [name]);

  const valid = name.trim().length >= 2;

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (valid) onSubmit(name, false); }}
      className="space-y-3"
    >
      <p className="text-sm text-gray-600">
        {count === 1 ? "Se asignará a 1 documento." : `Se asignará a ${count} documentos.`}
      </p>
      <input
        ref={ref}
        list="clientes"
        value={name}
        onChange={(e) => setName(e.target.value)}
        // Mayús + Enter: pedido aparte aunque el cliente ya tenga uno abierto.
        onKeyDown={(e) => { if (e.key === "Enter" && e.shiftKey && valid) { e.preventDefault(); onSubmit(name, true); } }}
        placeholder="Escriba el nombre y presione Enter"
        aria-label="Nombre del cliente"
        maxLength={100}
        autoComplete="off"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
      />
      <datalist id="clientes">{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">Enter asignar · Mayús + Enter pedido aparte · Esc cancelar</span>
        {onUnassign && (
          <button type="button" onClick={onUnassign} className="text-xs text-red-600 hover:underline">
            Quitar del pedido
          </button>
        )}
      </div>
    </form>
  );
}

function OrderHeader({ order, run }: {
  order: AgentOrder;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const update = (patch: Record<string, unknown>) => run(() => agentCall("POST", `/api/orders/${order.id}/update`, patch));
  return (
    <div className="flex flex-wrap items-center gap-3">
      <input
        key={order.customer_name}
        defaultValue={order.customer_name}
        aria-label="Nombre del cliente"
        onBlur={(e) => { const v = e.target.value.trim(); if (v.length >= 2 && v !== order.customer_name) void update({ customer_name: v }); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="w-56 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-semibold text-gray-900 hover:border-gray-300 focus:border-blue-500 focus:bg-white focus:outline-none"
      />
      <span className="font-mono text-xs text-blue-700">{order.correlative}</span>
      <span className="text-sm font-semibold text-gray-900">{formatCurrency(order.total_price)}</span>
      <input
        key={order.notes ?? ""}
        defaultValue={order.notes ?? ""}
        placeholder="Observaciones del pedido"
        aria-label="Observaciones"
        onBlur={(e) => { if (e.target.value !== (order.notes ?? "")) void update({ notes: e.target.value }); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="min-w-40 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-gray-600 hover:border-gray-300 focus:border-blue-500 focus:bg-white focus:outline-none"
      />
      <Button size="sm" variant="outline" title="Confirma lo impreso, cierra el pedido e inicia el plazo de conservación"
        onClick={() => run(() => agentCall("POST", `/api/orders/${order.id}/finish`))}>
        Entregado
      </Button>
      <Button size="sm" variant="ghost" className="text-red-600"
        onClick={() => { if (confirm(`¿Cancelar el pedido de ${order.customer_name}?`)) void run(() => agentCall("POST", `/api/orders/${order.id}/cancel`)); }}>
        Cancelar
      </Button>
    </div>
  );
}
