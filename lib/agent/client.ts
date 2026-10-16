"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getAgentSession } from "@/app/admin/agent-session";
import type { AgentState } from "./types";

// El agente solo escucha en esta misma computadora.
export const AGENT_URL = (process.env.NEXT_PUBLIC_AGENT_URL ?? "http://127.0.0.1:47821").replace(/\/$/, "");

export class AgentError extends Error {
  constructor(message: string, public status: number, public problems?: string[]) {
    super(message);
  }
}

let session: { token: string; exp: number; role: "admin" | "operator" } | null = null;
let pending: Promise<void> | null = null;

async function ensureSession(force = false) {
  if (!force && session && session.exp - 120 > Date.now() / 1000) return session;
  pending ??= getAgentSession()
    .then((s) => {
      if (!s.ok) throw new AgentError(s.error, 401);
      session = { token: s.token, exp: s.exp, role: s.role };
    })
    .finally(() => {
      pending = null;
    });
  await pending;
  return session!;
}

async function rawFetch(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
  let s = await ensureSession();
  const run = () =>
    fetch(AGENT_URL + path, {
      method,
      signal,
      headers: { Authorization: `Bearer ${s.token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  let res: Response;
  try {
    res = await run();
    if (res.status === 401) {
      s = await ensureSession(true);
      res = await run();
    }
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new AgentError("No hay conexión con el agente local. Verifique que esté en ejecución en esta computadora.", 0);
  }
  return res;
}

export async function agentCall<T = { ok: true }>(method: "GET" | "POST", path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await rawFetch(method, path, method === "POST" ? body ?? {} : undefined, signal);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AgentError(data.error ?? `Error ${res.status}`, res.status, data.problems);
  return data as T;
}

/** Descarga el PDF local y devuelve una URL temporal para mostrarlo. Hay que liberarla con revokeObjectURL. */
export async function agentPdfUrl(documentId: string): Promise<string> {
  const res = await rawFetch("GET", `/api/documents/${documentId}/pdf`);
  if (!res.ok) throw new AgentError("El PDF no está disponible en esta computadora.", res.status);
  return URL.createObjectURL(await res.blob());
}

export const agentRole = () => session?.role ?? null;

/** Estado en vivo del agente: se actualiza solo, sin recargar la página. */
export function useAgentState() {
  const [state, setState] = useState<AgentState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<"admin" | "operator" | null>(null);
  const wake = useRef<(() => void) | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    let alive = true;
    let backoff = 3000;
    (async () => {
      while (alive) {
        try {
          const s = await agentCall<AgentState>("GET", "/api/state", undefined, abort.signal);
          if (!alive) return;
          setState(s);
          setError(null);
          setRole(agentRole());
          backoff = 3000;
          // Espera larga: responde en cuanto algo cambia en el agente.
          await Promise.race([
            agentCall("GET", `/api/changes?since=${s.agent.version}`, undefined, abort.signal),
            new Promise<void>((resolve) => (wake.current = resolve)),
          ]);
        } catch (err) {
          if (!alive || (err as Error)?.name === "AbortError") return;
          setError((err as Error).message);
          await new Promise((r) => setTimeout(r, backoff));
          backoff = Math.min(backoff * 2, 30000);
        }
      }
    })();
    return () => {
      alive = false;
      abort.abort();
    };
  }, []);

  const refresh = useCallback(() => wake.current?.(), []);
  return { state, error, role, refresh };
}
