// Solo servidor: se importa únicamente desde acciones "use server".
import { createHmac } from "node:crypto";

// Debe coincidir con print-agent/src/auth.js
const MIN_SECRET_LENGTH = 32;
const TTL_SECONDS = 8 * 60 * 60;

export interface AgentTokenPayload {
  sub: string;
  email: string;
  role: "admin" | "operator";
  exp: number;
}

/**
 * Firma una credencial corta para que el navegador hable con el agente local.
 * El secreto AGENT_SECRET_TOKEN solo existe en el servidor y en el agente.
 */
export function signAgentToken(user: Omit<AgentTokenPayload, "exp">): { token: string; exp: number } | null {
  const secret = process.env.AGENT_SECRET_TOKEN ?? "";
  if (secret.length < MIN_SECRET_LENGTH) return null;
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const body = Buffer.from(JSON.stringify({ ...user, exp })).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return { token: `${body}.${sig}`, exp };
}
