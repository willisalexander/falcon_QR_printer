"use server";

import { createClient } from "@/lib/supabase/server";
import { signAgentToken } from "@/lib/agent/token";

type AgentSession =
  | { ok: true; token: string; exp: number; role: "admin" | "operator" }
  | { ok: false; error: string };

/** Entrega al personal autenticado una credencial temporal para el agente local. */
export async function getAgentSession(): Promise<AgentSession> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "No autorizado" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, is_active, email")
    .eq("id", user.id)
    .single();

  if (!profile?.is_active || !["admin", "operator"].includes(profile.role ?? "")) {
    return { ok: false, error: "No autorizado" };
  }

  const signed = signAgentToken({ sub: user.id, email: profile.email ?? user.email ?? "", role: profile.role });
  if (!signed) {
    return { ok: false, error: "Falta configurar AGENT_SECRET_TOKEN (mínimo 32 caracteres) en el servidor del panel." };
  }
  return { ok: true, ...signed, role: profile.role };
}
