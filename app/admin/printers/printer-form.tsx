"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createPrinter, updatePrinter } from "./actions";
import type { Printer } from "@/types";

interface PrinterFormProps {
  printer?: Printer;
  onClose: () => void;
}

export function PrinterForm({ printer, onClose }: PrinterFormProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const result = printer
        ? await updatePrinter(printer.id, formData)
        : await createPrinter(formData);

      if (result.success) {
        onClose();
      } else {
        setError(result.error ?? "Error desconocido");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        name="name"
        label="Nombre descriptivo"
        placeholder="Ej: HP LaserJet Principal"
        defaultValue={printer?.name}
        required
      />
      <Input
        name="system_name"
        label="Nombre del sistema (OS)"
        placeholder="Ej: HP LaserJet Pro M404n"
        defaultValue={printer?.system_name}
        hint="Nombre exacto como aparece en Windows/Linux"
        required
      />
      <Select
        name="print_type"
        label="Tipo de impresión"
        defaultValue={printer?.print_type ?? "bw"}
        options={[
          { value: "bw", label: "Blanco y Negro" },
          { value: "color", label: "Color" },
        ]}
        required
      />
      <Select
        name="is_active"
        label="Estado"
        defaultValue={String(printer?.is_active ?? true)}
        options={[
          { value: "true", label: "Activa" },
          { value: "false", label: "Inactiva" },
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
