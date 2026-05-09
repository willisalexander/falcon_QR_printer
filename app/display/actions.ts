"use server";

import { createServiceClient } from "@/lib/supabase/server";
import { MAX_USES, MAX_AGE_MS } from "./constants";

export interface AutoTokenInfo {
  tokenSlug: string;
  createdAt: string;
  useCount: number;
}

export async function getOrCreateAutoToken(): Promise<AutoTokenInfo> {
  const supabase = await createServiceClient();
  const oneHourAgo = new Date(Date.now() - MAX_AGE_MS).toISOString();

  const { data: tokens } = await supabase
    .from("qr_tokens")
    .select("id, token, created_at, use_count")
    .eq("is_auto", true)
    .eq("is_active", true)
    .gte("created_at", oneHourAgo)
    .order("created_at", { ascending: false })
    .limit(1);

  if (tokens && tokens.length > 0) {
    const t = tokens[0];
    const useCount: number = t.use_count ?? 0;

    if (useCount < MAX_USES) {
      return { tokenSlug: t.token, createdAt: t.created_at, useCount };
    }

    await supabase.from("qr_tokens").update({ is_active: false }).eq("id", t.id);
  }

  const expiresAt = new Date(Date.now() + MAX_AGE_MS).toISOString();
  const now = new Date().toLocaleString("es-GT", { timeZone: "America/Guatemala" });

  const { data: newToken, error } = await supabase
    .from("qr_tokens")
    .insert({
      label: `Auto ${now}`,
      is_active: true,
      is_auto: true,
      expires_at: expiresAt,
    })
    .select("id, token, created_at")
    .single();

  if (error || !newToken) throw new Error("No se pudo crear el token automatico");

  return { tokenSlug: newToken.token, createdAt: newToken.created_at, useCount: 0 };
}