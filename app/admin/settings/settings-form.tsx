"use client";

import { useState, useTransition } from "react";
import { CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Card, CardTitle } from "@/components/ui/card";
import { updateSettings } from "./actions";
import type { SystemSettings } from "@/types";

interface SettingsFormProps {
  settings: SystemSettings;
}

export function SettingsForm({ settings }: SettingsFormProps) {
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const result = await updateSettings(formData);
      if (result.success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } else {
        setError(result.error ?? "Error al guardar");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Precios */}
      <Card>
        <CardTitle className="mb-4">Precios</CardTitle>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            name="price_bw"
            label="Precio B/N por página (Q)"
            type="number"
            step="0.01"
            min="0"
            defaultValue={settings.price_bw}
            hint="Precio en Quetzales por cada página en blanco y negro"
            required
          />
          <Input
            name="price_color"
            label="Precio Color por página (Q)"
            type="number"
            step="0.01"
            min="0"
            defaultValue={settings.price_color}
            hint="Precio en Quetzales por cada página a color"
            required
          />
        </div>
      </Card>

      {/* Límites */}
      <Card>
        <CardTitle className="mb-4">Límites y restricciones</CardTitle>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            name="max_pages_without_approval"
            label="Máx. páginas sin aprobación"
            type="number"
            min="1"
            defaultValue={settings.max_pages_without_approval}
            hint="Trabajos con más páginas requieren aprobación manual"
            required
          />
          <Input
            name="max_file_size_mb"
            label="Tamaño máximo de archivo (MB)"
            type="number"
            min="1"
            max="50"
            defaultValue={settings.max_file_size_mb}
            required
          />
        </div>
      </Card>

      {/* General */}
      <Card>
        <CardTitle className="mb-4">General</CardTitle>
        <div className="space-y-4">
          <Input
            name="business_name"
            label="Nombre del negocio"
            defaultValue={settings.business_name}
            required
          />
          <Select
            name="system_active"
            label="Estado del sistema"
            defaultValue={String(settings.system_active)}
            options={[
              { value: "true", label: "Activo — aceptando impresiones" },
              { value: "false", label: "Inactivo — no acepta impresiones" },
            ]}
          />
          <Textarea
            name="public_message"
            label="Mensaje público para clientes"
            defaultValue={settings.public_message}
            rows={3}
            hint="Este texto lo ven los clientes en el formulario de impresión"
          />
        </div>
      </Card>

      {/* Footer */}
      <div className="flex items-center justify-between">
        {error && <p className="text-sm text-red-600">{error}</p>}
        {saved && (
          <p className="flex items-center gap-1.5 text-sm text-green-600">
            <CheckCircle className="h-4 w-4" />
            Configuración guardada correctamente
          </p>
        )}
        {!error && !saved && <span />}
        <Button type="submit" loading={isPending} size="lg">
          Guardar configuración
        </Button>
      </div>
    </form>
  );
}
