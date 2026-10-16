"use client";

import { useEffect, useState } from "react";
import type { AgentState } from "./types";

const AGENT_PC_KEY = "fqp-esta-pc-tiene-agente";

/**
 * ¿Mostrar Recepción e Historial "a distancia"?
 * Solo en computadoras SIN agente. Un navegador que alguna vez se conectó a su
 * agente es la PC del negocio: ahí, si el agente se detiene, debe verse el aviso
 * de "sin conexión" para que alguien lo reinicie, no una vista recortada.
 */
export function useRemoteMode(state: AgentState | null, error: string | null) {
  const [hasAgent, setHasAgent] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      setHasAgent(localStorage.getItem(AGENT_PC_KEY) === "1");
    } catch {
      setHasAgent(false);
    }
  }, []);

  useEffect(() => {
    if (!state) return;
    try {
      localStorage.setItem(AGENT_PC_KEY, "1");
    } catch {
      /* sin almacenamiento: se decide solo por la conexión actual */
    }
    setHasAgent(true);
  }, [state]);

  return hasAgent === false && !state && !!error;
}
