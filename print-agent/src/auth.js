/**
 * Credencial corta que el panel (servidor Next.js) entrega a un usuario del
 * personal ya autenticado, firmada con el secreto compartido AGENT_SECRET_TOKEN.
 * El agente la verifica sin depender de internet.
 * Formato: base64url(JSON) + "." + base64url(HMAC-SHA256).
 * Debe coincidir con lib/agent/token.ts del panel.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const MIN_SECRET_LENGTH = 32;

const sign = (secret, body) => createHmac("sha256", secret).update(body).digest("base64url");

export function signToken(secret, payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(secret, body)}`;
}

/** Devuelve el contenido si la firma es válida y no venció; si no, null. */
export function verifyToken(secret, token, nowMs = Date.now()) {
  if (!secret || secret.length < MIN_SECRET_LENGTH || typeof token !== "string") return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const expected = Buffer.from(sign(secret, body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof payload.exp !== "number" || payload.exp * 1000 < nowMs) return null;
    if (!["admin", "operator"].includes(payload.role)) return null;
    return payload;
  } catch {
    return null;
  }
}
