"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

const uuidSchema = z.string().uuid();

async function requireStaff() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("No autorizado");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, is_active")
    .eq("id", user.id)
    .single();

  if (!profile?.is_active || !["admin", "operator"].includes(profile.role ?? "")) {
    throw new Error("No autorizado");
  }
  return { supabase, user };
}

export async function createToken(label: string) {
  const safeLabel = String(label).trim().slice(0, 100) || "QR sin nombre";
  try {
    const { supabase, user } = await requireStaff();
    const { error } = await supabase.from("qr_tokens").insert({
      label: safeLabel,
      is_active: true,
      created_by: user.id,
    });
    if (error) return { success: false, error: error.message };
    revalidatePath("/admin/qr");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function deleteToken(tokenId: string) {
  if (!uuidSchema.safeParse(tokenId).success) return { success: false, error: "ID inválido" };
  try {
    const { supabase } = await requireStaff();
    const { error } = await supabase.from("qr_tokens").delete().eq("id", tokenId);
    if (error) return { success: false, error: error.message };
    revalidatePath("/admin/qr");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error" };
  }
}

export async function toggleQrActive(tokenId: string, isActive: boolean) {
  if (!uuidSchema.safeParse(tokenId).success) return { success: false, error: "ID inválido" };
  try {
    const { supabase } = await requireStaff();
    const { error } = await supabase
      .from("qr_tokens")
      .update({ is_active: Boolean(isActive) })
      .eq("id", tokenId);
    if (error) return { success: false, error: error.message };
    revalidatePath("/admin/qr");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Error" };
  }
}
