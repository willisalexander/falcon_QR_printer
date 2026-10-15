"use client";

import { useState, useTransition } from "react";
import { CheckCircle } from "lucide-react";
import { AgentStatusBar } from "@/components/admin/agent-status";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { agentCall, useAgentState } from "@/lib/agent/client";
import { updateLocalSettings } from "./actions";

interface Props {
  settings: Record<string, string>;
}

export function LocalSettingsForm({ settings }: Props) {
  const { state, error: agentError, role } = useAgentState();
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await updateLocalSettings(formData);
      if (result.success) {
        // El agente aplica los cambios al momento (y, si no está en línea, en su próxima sincronización).
        agentCall("POST", "/api/config/refresh").catch(() => {});
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } else {
        setError(result.error ?? "Error al guardar");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <h2 className="mb-1 text-base font-semibold text-gray-900">Recepción local de documentos</h2>
        <p className="mb-3 text-sm text-gray-500">
          Ajustes del agente instalado en esta computadora. Nada se imprime sin que el operador lo autorice.
        </p>
        <AgentStatusBar state={state} error={agentError} role={role} />
      </div>

      <Card>
        <CardTitle className="mb-4">Carpeta vigilada y límites</CardTitle>
        <div className="space-y-4">
          <Input
            label="Carpeta vigilada"
            value={state?.agent.watchFolder ?? "C:\\ElArrecife\\Entradas (agente sin conexión)"}
            readOnly
            disabled
            hint="Por seguridad la carpeta solo se cambia en el archivo .env del agente (WATCH_DIR), no desde el navegador."
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              name="local_max_file_size_mb"
              label="Tamaño máximo por archivo (MB)"
              type="number" min="1" max="500"
              defaultValue={settings.local_max_file_size_mb ?? "50"}
              required
            />
            <Input
              name="file_stability_ms"
              label="Espera de descarga completa (ms)"
              type="number" min="500" max="60000" step="100"
              defaultValue={settings.file_stability_ms ?? "2000"}
              hint="Tiempo sin cambios para considerar que el archivo terminó de descargarse"
              required
            />
          </div>
        </div>
      </Card>

      <Card>
        <CardTitle className="mb-4">Conversión a PDF y análisis</CardTitle>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Input
            name="convert_timeout_sec"
            label="Tiempo máximo (s)"
            type="number" min="10" max="900"
            defaultValue={settings.convert_timeout_sec ?? "120"}
            required
          />
          <Input
            name="convert_concurrency"
            label="Conversiones simultáneas"
            type="number" min="1" max="4"
            defaultValue={settings.convert_concurrency ?? "1"}
            hint="Suba a 2 solo si la PC lo soporta"
            required
          />
          <Input
            name="paper_tolerance_pt"
            label="Tolerancia de tamaño (pt)"
            type="number" min="1" max="20" step="0.5"
            defaultValue={settings.paper_tolerance_pt ?? "8"}
            hint="72 pt = 1 pulgada"
            required
          />
        </div>
      </Card>

      <Card>
        <CardTitle className="mb-4">Impresión</CardTitle>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            name="printer_wait_min"
            label="Espera por impresora no disponible (min)"
            type="number" min="1" max="240"
            defaultValue={settings.printer_wait_min ?? "10"}
            hint="Pasado este tiempo el trabajo queda en error en lugar de imprimirse más tarde"
            required
          />
          <Select
            name="auto_confirm_spooler"
            label="Confirmación de impresión"
            defaultValue={settings.auto_confirm_spooler ?? "false"}
            options={[
              { value: "false", label: "El operador confirma (recomendado)" },
              { value: "true", label: "Confirmar cuando sale de la cola de Windows" },
            ]}
            hint="Que Windows termine el trabajo no garantiza que el papel haya salido"
          />
        </div>
      </Card>

      <Card>
        <CardTitle className="mb-4">Retención de documentos</CardTitle>
        <Input
          name="retention_days"
          label="Días de conservación después de finalizar el pedido"
          type="number" min="1" max="3650"
          defaultValue={settings.retention_days ?? "30"}
          hint="Al vencer se eliminan el original y el PDF de esta computadora; los datos del pedido se conservan. No es un borrado irrecuperable del disco."
          required
        />
      </Card>

      <div className="flex items-center justify-between">
        {error && <p className="text-sm text-red-600">{error}</p>}
        {saved && (
          <p className="flex items-center gap-1.5 text-sm text-green-600">
            <CheckCircle className="h-4 w-4" />
            Configuración local guardada
          </p>
        )}
        {!error && !saved && <span />}
        <Button type="submit" loading={isPending} size="lg">
          Guardar configuración local
        </Button>
      </div>
    </form>
  );
}
