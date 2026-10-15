"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { agentCall } from "@/lib/agent/client";
import { PAPER_LABELS } from "@/lib/agent/labels";
import { cn } from "@/lib/utils";
import { deleteRule, saveRule, toggleRule } from "./actions";
import type { Printer, PrinterRule } from "@/types";

const PAPER = [
  { value: "any", label: "Cualquier tamaño" },
  { value: "carta", label: "Carta" },
  { value: "oficio2", label: "Oficio II" },
  { value: "legal", label: "Legal" },
  { value: "a4", label: "A4" },
];
const COLOR = [
  { value: "any", label: "B/N o color" },
  { value: "bw", label: "Blanco y negro" },
  { value: "color", label: "Color" },
];
const DUPLEX = [
  { value: "any", label: "Simple o dúplex" },
  { value: "no", label: "Solo simple" },
  { value: "yes", label: "Solo dúplex" },
];
const label = (list: { value: string; label: string }[], v: string) => list.find((o) => o.value === v)?.label ?? v;

/** El agente relee la configuración en cuanto se guarda (si está en ejecución). */
const notifyAgent = () => agentCall("POST", "/api/config/refresh").catch(() => {});

export function RulesClient({ rules, printers, isAdmin }: { rules: PrinterRule[]; printers: Printer[]; isAdmin: boolean }) {
  const [editing, setEditing] = useState<PrinterRule | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const printerOf = (id: string) => printers.find((p) => p.id === id);

  function act(fn: () => Promise<{ success: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (r.success) void notifyAgent();
      else setError(r.error ?? "Error al guardar");
    });
  }

  /** Avisa cuando la regla nunca podrá aplicarse con la impresora tal como está configurada. */
  function conflict(rule: PrinterRule): string | null {
    const p = printerOf(rule.printer_id);
    if (!p) return "La impresora ya no existe";
    if (!p.is_active) return "La impresora está deshabilitada";
    if (rule.paper_size !== "any" && !(p.paper_sizes ?? []).includes(rule.paper_size)) return `La impresora no tiene configurado ${PAPER_LABELS[rule.paper_size]}`;
    if (rule.color_mode === "color" && !p.supports_color) return "La impresora no imprime a color";
    if (rule.duplex === "yes" && !p.supports_duplex) return "La impresora no tiene dúplex";
    return null;
  }

  return (
    <>
      <div className="mb-4 flex items-start justify-between gap-4">
        <p className="max-w-3xl text-sm text-gray-500">
          Para cada documento se evalúan las reglas habilitadas en orden de prioridad (número menor primero) y se usa la primera cuya
          impresora pueda con el trabajo. Si ninguna coincide, el sistema pide al operador que elija la impresora.
        </p>
        {isAdmin && (
          <Button onClick={() => setEditing("new")} disabled={printers.length === 0}>
            <Plus className="h-4 w-4" />
            Agregar regla
          </Button>
        )}
      </div>

      {printers.length === 0 && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Primero registre al menos una impresora en la sección Impresoras.
        </p>
      )}
      {error && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3">Orden</th>
              <th className="px-4 py-3">Regla</th>
              <th className="px-4 py-3">Cuando el documento es…</th>
              <th className="px-4 py-3">Imprimir en</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400">No hay reglas. Sin reglas, cada documento requiere elegir la impresora a mano.</td></tr>
            )}
            {rules.map((rule) => {
              const warn = conflict(rule);
              return (
                <tr key={rule.id} className={cn("border-t border-gray-100", !rule.enabled && "opacity-60")}>
                  <td className="px-4 py-3 font-mono">{rule.priority}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{rule.name}</td>
                  <td className="px-4 py-3 text-gray-700">
                    {label(PAPER, rule.paper_size)} · {label(COLOR, rule.color_mode)} · {label(DUPLEX, rule.duplex)}
                    {(rule.min_pages || rule.max_pages) && (
                      <span className="text-gray-500"> · {rule.min_pages ?? 1}–{rule.max_pages ?? "∞"} pág.</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {printerOf(rule.printer_id)?.name ?? "—"}
                    {rule.tray && <span className="text-xs text-gray-500"> · {rule.tray}</span>}
                    {warn && <p className="text-xs text-red-600">{warn}: esta regla no se aplicará</p>}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      disabled={!isAdmin || isPending}
                      onClick={() => act(() => toggleRule(rule.id, !rule.enabled))}
                      className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", rule.enabled ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600")}
                    >
                      {rule.enabled ? "Habilitada" : "Deshabilitada"}
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    {isAdmin && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(rule)}><Pencil className="h-3.5 w-3.5" />Editar</Button>
                        <Button size="sm" variant="ghost" className="text-red-500" disabled={isPending}
                          onClick={() => { if (confirm("¿Eliminar esta regla?")) act(() => deleteRule(rule.id)); }}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "Agregar regla" : "Editar regla"} className="max-w-lg">
        {editing && <RuleForm rule={editing === "new" ? null : editing} printers={printers} onClose={() => setEditing(null)} />}
      </Modal>
    </>
  );
}

function RuleForm({ rule, printers, onClose }: { rule: PrinterRule | null; printers: Printer[]; onClose: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await saveRule(rule?.id ?? null, formData);
      if (result.success) {
        void notifyAgent();
        onClose();
      } else {
        setError(result.error ?? "Error desconocido");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <Input name="name" label="Nombre" placeholder="Ej: Carta blanco y negro" defaultValue={rule?.name} required />
        </div>
        <Input name="priority" label="Orden" type="number" min="1" max="999" defaultValue={rule?.priority ?? 100} required />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Select name="paper_size" label="Tamaño" defaultValue={rule?.paper_size ?? "any"} options={PAPER} />
        <Select name="color_mode" label="Color" defaultValue={rule?.color_mode ?? "any"} options={COLOR} />
        <Select name="duplex" label="Caras" defaultValue={rule?.duplex ?? "any"} options={DUPLEX} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Input name="min_pages" label="Páginas mínimas (opcional)" type="number" min="1" defaultValue={rule?.min_pages ?? ""} />
        <Input name="max_pages" label="Páginas máximas (opcional)" type="number" min="1" defaultValue={rule?.max_pages ?? ""} />
      </div>
      <Select
        name="printer_id"
        label="Impresora"
        defaultValue={rule?.printer_id ?? printers[0]?.id}
        options={printers.map((p) => ({ value: p.id, label: `${p.name}${p.is_active ? "" : " (deshabilitada)"}` }))}
        required
      />
      <Input name="tray" label="Bandeja (opcional)" defaultValue={rule?.tray ?? ""} hint="Vacío = la bandeja configurada en la impresora para ese tamaño" />
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" name="enabled" defaultChecked={rule?.enabled ?? true} />
        Regla habilitada
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex justify-end gap-3 pt-2">
        <Button variant="outline" type="button" onClick={onClose} disabled={isPending}>Cancelar</Button>
        <Button type="submit" loading={isPending}>{rule ? "Guardar cambios" : "Agregar regla"}</Button>
      </div>
    </form>
  );
}
