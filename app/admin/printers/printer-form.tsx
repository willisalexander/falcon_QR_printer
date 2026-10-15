"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { agentCall } from "@/lib/agent/client";
import { PAPER_OPTIONS } from "@/lib/agent/labels";
import { createPrinter, updatePrinter } from "./actions";
import type { Printer } from "@/types";

interface PrinterFormProps {
  printer?: Printer;
  onClose: () => void;
}

interface SystemPrinter { name: string; status: string; offline: boolean }
interface Detected {
  capabilities: { valid: boolean; canDuplex?: boolean; supportsColor?: boolean; bins?: string[] };
  detectedPaperSizes: string[];
}

export function PrinterForm({ printer, onClose }: PrinterFormProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [systemName, setSystemName] = useState(printer?.system_name ?? "");
  const [printType, setPrintType] = useState<string>(printer?.print_type ?? "bw");
  const [duplex, setDuplex] = useState(printer?.supports_duplex ?? false);
  const [sizes, setSizes] = useState<string[]>(printer?.paper_sizes ?? ["carta"]);
  const [trays, setTrays] = useState<Record<string, string>>(printer?.trays ?? {});
  const [installed, setInstalled] = useState<SystemPrinter[]>([]);
  const [detected, setDetected] = useState<Detected | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectMsg, setDetectMsg] = useState<string | null>(null);

  // Impresoras instaladas en Windows, según el agente local (si está en ejecución).
  useEffect(() => {
    agentCall<{ printers: SystemPrinter[] }>("GET", "/api/printers/system")
      .then((r) => setInstalled(r.printers))
      .catch(() => {});
  }, []);

  async function detect() {
    if (!systemName) return;
    setDetecting(true);
    setDetectMsg(null);
    try {
      const d = await agentCall<Detected>("GET", `/api/printers/system?name=${encodeURIComponent(systemName)}`);
      if (!d.capabilities.valid) {
        setDetectMsg("Windows no devolvió las capacidades de esta impresora. Complete los datos manualmente.");
        return;
      }
      setDetected(d);
      setDuplex(!!d.capabilities.canDuplex);
      setPrintType(d.capabilities.supportsColor ? "color" : "bw");
      if (d.detectedPaperSizes.length) setSizes(d.detectedPaperSizes);
      setDetectMsg("Capacidades leídas del driver de Windows. Revise y corrija si su equipo real difiere.");
    } catch (e) {
      setDetectMsg((e as Error).message);
    } finally {
      setDetecting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const result = printer
        ? await updatePrinter(printer.id, formData)
        : await createPrinter(formData);

      if (result.success) {
        // El agente toma la configuración nueva de inmediato.
        agentCall("POST", "/api/config/refresh").catch(() => {});
        onClose();
      } else {
        setError(result.error ?? "Error desconocido");
      }
    });
  }

  const bins = detected?.capabilities.bins ?? [];

  return (
    <form onSubmit={handleSubmit} className="max-h-[75vh] space-y-4 overflow-y-auto pr-1">
      <Input
        name="name"
        label="Nombre descriptivo"
        placeholder="Ej: HP LaserJet Principal"
        defaultValue={printer?.name}
        required
      />
      <div>
        <Input
          name="system_name"
          label="Nombre exacto en Windows"
          placeholder="Ej: HP LaserJet Pro M404n"
          value={systemName}
          onChange={(e) => setSystemName(e.target.value)}
          list="impresoras-windows"
          hint={installed.length ? "Elija una de las impresoras instaladas en esta computadora" : "Nombre exacto como aparece en Windows"}
          required
        />
        <datalist id="impresoras-windows">
          {installed.map((p) => <option key={p.name} value={p.name}>{p.offline ? "Sin conexión" : p.status}</option>)}
        </datalist>
        <div className="mt-2 flex items-center gap-3">
          <Button type="button" size="sm" variant="outline" onClick={detect} loading={detecting} disabled={!systemName}>
            Detectar capacidades
          </Button>
          {detectMsg && <span className="text-xs text-gray-600">{detectMsg}</span>}
        </div>
      </div>
      <Select
        name="print_type"
        label="Tipo de impresión"
        value={printType}
        onChange={(e) => setPrintType(e.target.value)}
        options={[
          { value: "bw", label: "Solo blanco y negro" },
          { value: "color", label: "Color (también imprime B/N)" },
        ]}
        required
      />

      <fieldset className="rounded-lg border border-gray-200 p-3">
        <legend className="px-1 text-sm font-medium text-gray-700">Tamaños de papel cargados y su bandeja</legend>
        <p className="mb-2 text-xs text-gray-500">
          Marque solo los tamaños que esta impresora tiene realmente disponibles. La bandeja es opcional (vacío = la elige el driver).
        </p>
        <div className="space-y-2">
          {PAPER_OPTIONS.map((o) => {
            const on = sizes.includes(o.value);
            return (
              <div key={o.value} className="flex items-center gap-3">
                <label className="flex w-48 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name={`paper_${o.value}`}
                    checked={on}
                    onChange={(e) => setSizes(e.target.checked ? [...sizes, o.value] : sizes.filter((s) => s !== o.value))}
                  />
                  {o.label}
                </label>
                <input
                  name={`tray_${o.value}`}
                  value={trays[o.value] ?? ""}
                  onChange={(e) => setTrays({ ...trays, [o.value]: e.target.value })}
                  disabled={!on}
                  list="bandejas"
                  placeholder="Bandeja (opcional)"
                  className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm disabled:bg-gray-50"
                />
              </div>
            );
          })}
        </div>
        <datalist id="bandejas">{bins.map((b) => <option key={b} value={b} />)}</datalist>
      </fieldset>

      <div className="grid grid-cols-2 gap-4">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" name="supports_duplex" checked={duplex} onChange={(e) => setDuplex(e.target.checked)} />
          Imprime a doble cara (dúplex)
        </label>
        <Input
          name="priority"
          label="Prioridad (1 = primera)"
          type="number"
          min="1"
          max="999"
          defaultValue={printer?.priority ?? 100}
        />
      </div>
      <input type="hidden" name="capabilities_checked" value={String(!!detected)} />

      <Select
        name="is_active"
        label="Estado"
        defaultValue={String(printer?.is_active ?? true)}
        options={[
          { value: "true", label: "Habilitada" },
          { value: "false", label: "Deshabilitada" },
        ]}
      />
      <Input
        name="location"
        label="Ubicación (opcional)"
        placeholder="Ej: Escritorio 1"
        defaultValue={printer?.location ?? ""}
      />
      <Textarea
        name="notes"
        label="Notas (opcional)"
        placeholder="Observaciones sobre esta impresora..."
        defaultValue={printer?.notes ?? ""}
      />

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-3 justify-end pt-2">
        <Button variant="outline" type="button" onClick={onClose} disabled={isPending}>
          Cancelar
        </Button>
        <Button type="submit" loading={isPending}>
          {printer ? "Guardar cambios" : "Agregar impresora"}
        </Button>
      </div>
    </form>
  );
}
