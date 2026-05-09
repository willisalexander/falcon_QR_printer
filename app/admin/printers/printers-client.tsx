"use client";

import { useState, useTransition } from "react";
import { Plus, Star, Pencil, Trash2, CheckCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { PrinterForm } from "./printer-form";
import { setDefaultPrinter, togglePrinterActive, deletePrinter } from "./actions";
import { cn } from "@/lib/utils";
import type { Printer } from "@/types";

interface PrintersClientProps {
  printers: Printer[];
}

export function PrintersClient({ printers }: PrintersClientProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [editPrinter, setEditPrinter] = useState<Printer | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDefault(id: string, type: "bw" | "color") {
    setActionError(null);
    startTransition(async () => {
      const result = await setDefaultPrinter(id, type);
      if (!result.success) setActionError(result.error ?? "Error al guardar");
    });
  }

  function handleToggle(id: string, isActive: boolean) {
    setActionError(null);
    startTransition(async () => {
      const result = await togglePrinterActive(id, isActive);
      if (!result.success) setActionError(result.error ?? "Error al actualizar");
    });
  }

  function handleDelete(id: string) {
    if (!confirm("¿Eliminar esta impresora?")) return;
    setActionError(null);
    startTransition(async () => {
      const result = await deletePrinter(id);
      if (!result.success) setActionError(result.error ?? "Error al eliminar");
    });
  }

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" />
          Agregar impresora
        </Button>
      </div>

      {actionError && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {actionError}
        </div>
      )}

      {printers.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 p-12 text-center">
          <p className="text-gray-400">
            No hay impresoras registradas. Agrega la primera.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {printers.map((printer) => (
            <div
              key={printer.id}
              className={cn(
                "rounded-xl border p-5 transition-colors",
                printer.is_active
                  ? "border-gray-200 bg-white"
                  : "border-gray-100 bg-gray-50"
              )}
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-gray-900">{printer.name}</h3>
                  <p className="mt-0.5 text-xs text-gray-500 font-mono">
                    {printer.system_name}
                  </p>
                </div>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-xs font-medium",
                    printer.print_type === "bw"
                      ? "bg-gray-100 text-gray-700"
                      : "bg-blue-100 text-blue-700"
                  )}
                >
                  {printer.print_type === "bw" ? "B/N" : "Color"}
                </span>
              </div>

              {/* Badges de default */}
              <div className="mt-3 flex gap-2 flex-wrap">
                {printer.is_default_bw && (
                  <span className="flex items-center gap-1 rounded-full bg-yellow-50 border border-yellow-200 px-2 py-0.5 text-xs text-yellow-700">
                    <Star className="h-3 w-3 fill-yellow-500 text-yellow-500" />
                    Default B/N
                  </span>
                )}
                {printer.is_default_color && (
                  <span className="flex items-center gap-1 rounded-full bg-yellow-50 border border-yellow-200 px-2 py-0.5 text-xs text-yellow-700">
                    <Star className="h-3 w-3 fill-yellow-500 text-yellow-500" />
                    Default Color
                  </span>
                )}
                <span
                  className={cn(
                    "flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
                    printer.is_active
                      ? "bg-green-50 text-green-700"
                      : "bg-gray-100 text-gray-500"
                  )}
                >
                  {printer.is_active ? (
                    <CheckCircle className="h-3 w-3" />
                  ) : (
                    <XCircle className="h-3 w-3" />
                  )}
                  {printer.is_active ? "Activa" : "Inactiva"}
                </span>
              </div>

              {printer.location && (
                <p className="mt-2 text-xs text-gray-500">📍 {printer.location}</p>
              )}

              {/* Acciones */}
              <div className="mt-4 flex flex-wrap gap-2 border-t border-gray-100 pt-3">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditPrinter(printer)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Editar
                </Button>

                {printer.is_active && !printer.is_default_bw && printer.print_type === "bw" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isPending}
                    onClick={() => handleDefault(printer.id, "bw")}
                  >
                    <Star className="h-3.5 w-3.5" />
                    Default B/N
                  </Button>
                )}

                {printer.is_active && !printer.is_default_color && printer.print_type === "color" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isPending}
                    onClick={() => handleDefault(printer.id, "color")}
                  >
                    <Star className="h-3.5 w-3.5" />
                    Default Color
                  </Button>
                )}

                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => handleToggle(printer.id, !printer.is_active)}
                >
                  {printer.is_active ? "Desactivar" : "Activar"}
                </Button>

                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => handleDelete(printer.id)}
                  className="text-red-500 hover:text-red-700 hover:bg-red-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal: Agregar */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Agregar impresora" className="max-w-lg">
        <PrinterForm onClose={() => setAddOpen(false)} />
      </Modal>

      {/* Modal: Editar */}
      <Modal open={!!editPrinter} onClose={() => setEditPrinter(null)} title="Editar impresora" className="max-w-lg">
        {editPrinter && (
          <PrinterForm
            printer={editPrinter}
            onClose={() => setEditPrinter(null)}
          />
        )}
      </Modal>
    </>
  );
}
