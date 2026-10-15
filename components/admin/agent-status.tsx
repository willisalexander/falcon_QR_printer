"use client";

import { useState } from "react";
import { AlertTriangle, CloudOff, FolderOpen, Power, Zap } from "lucide-react";
import { agentCall, AGENT_URL } from "@/lib/agent/client";
import type { AgentState } from "@/lib/agent/types";
import { cn } from "@/lib/utils";

interface Props {
  state: AgentState | null;
  error: string | null;
  role: "admin" | "operator" | null;
}

/** Franja superior de las pantallas locales: conexión con el agente y modo de impresión. */
export function AgentStatusBar({ state, error }: Props) {
  const [busy, setBusy] = useState(false);
  const [modeError, setModeError] = useState<string | null>(null);

  if (!state) {
    return (
      <div className={cn("mb-4 rounded-lg border px-4 py-3 text-sm", error ? "border-red-200 bg-red-50 text-red-700" : "border-gray-200 bg-white text-gray-500")}>
        {error ? (
          <>
            <p className="font-medium">{error}</p>
            <p className="mt-1 text-xs">
              El agente debe estar ejecutándose en esta computadora ({AGENT_URL}). Si el panel se abre por HTTPS, el
              navegador pedirá permiso para acceder a la red local: acéptelo.
            </p>
          </>
        ) : (
          "Conectando con el agente local…"
        )}
      </div>
    );
  }

  const auto = state.mode === "auto";
  const { agent } = state;

  async function setMode(mode: "supervised") {
    setBusy(true);
    setModeError(null);
    try {
      await agentCall("POST", "/api/print-mode", { mode });
    } catch (e) {
      setModeError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 space-y-2">
      <div className={cn("flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border px-4 py-2.5 text-sm",
        auto ? "border-orange-300 bg-orange-50" : "border-gray-200 bg-white")}>
        <span className="flex items-center gap-1.5">
          <span className={cn("h-2 w-2 rounded-full", error ? "bg-red-500" : "bg-green-500")} />
          {error ? "Sin conexión con el agente" : "Agente conectado"}
        </span>
        <span className="flex items-center gap-1.5 text-gray-600" title="Carpeta vigilada">
          <FolderOpen className="h-4 w-4" />
          <span className="font-mono text-xs">{agent.watchFolder}</span>
        </span>
        {agent.sync.enabled && agent.sync.online === false && (
          <span className="flex items-center gap-1.5 text-amber-700" title={agent.sync.lastError ?? ""}>
            <CloudOff className="h-4 w-4" />
            Sin internet — {agent.sync.pending} cambio(s) por sincronizar
          </span>
        )}
        {(agent.processing.queued > 0 || agent.processing.converting > 0) && (
          <span className="text-purple-700">
            Convirtiendo {agent.processing.converting} · en cola {agent.processing.queued}
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          <span className={cn("flex items-center gap-1.5 font-medium", auto ? "text-orange-800" : "text-gray-700")}>
            {auto ? <Zap className="h-4 w-4" /> : null}
            Modo {auto ? "AUTOMÁTICO" : "supervisado"}
          </span>
          {auto ? (
            <button
              onClick={() => setMode("supervised")}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
            >
              <Power className="h-4 w-4" />
              Apagar automático
            </button>
          ) : null}
          {/* El modo automático no se ofrece desde el panel: el negocio trabaja en supervisado.
              Si el agente llegara a estar en automático, el botón de apagado sigue disponible. */}
        </div>
      </div>

      {modeError && <p className="text-sm text-red-600">{modeError}</p>}
      {!agent.libreOffice && (
        <p className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          LibreOffice no está instalado: los documentos Word quedarán en error hasta instalarlo.
        </p>
      )}
      {agent.printDriver !== "sumatra" && (
        <p className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          Agente en modo de prueba ({agent.printDriver}): los trabajos NO llegan a la impresora.
        </p>
      )}
      {agent.intake.ignored.length > 0 && (
        <p className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs text-gray-600">
          En la carpeta hay {agent.intake.ignored.length} archivo(s) que no se procesan (solo PDF, DOC y DOCX):{" "}
          {agent.intake.ignored.slice(0, 5).map((f) => f.name).join(", ")}
          {agent.intake.ignored.length > 5 ? "…" : ""}
        </p>
      )}
    </div>
  );
}
