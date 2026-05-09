"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

const settingsSchema = z.object({
  price_bw:                    z.coerce.number().positive("Precio B/N debe ser positivo"),
  price_color:                 z.coerce.number().positive("Precio Color debe ser positivo"),
  max_pages_without_approval:  z.coerce.number().int().min(1, "Mínimo 1 página"),
  max_file_size_mb:            z.coerce.number().int().min(1).max(100),
  system_active:               z.enum(["true", "false"]),
  public_message:              z.string().max(500).default(""),
  business_name:               z.string().min(1).max(100),
});

export async function updateSettings(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "No autorizado" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, is_active")
    .eq("id", user.id)
    .single();

  if (!profile?.is_active || profile.role !== "admin") {
    return { success: false, error: "Se requieren permisos de administrador" };
  }

  const raw = {
    price_bw:                   formData.get("price_bw"),
    price_color:                formData.get("price_color"),
    max_pages_without_approval: formData.get("max_pages_without_approval"),
    max_file_size_mb:           formData.get("max_file_size_mb"),
    system_active:              formData.get("system_active"),
    public_message:             formData.get("public_message") ?? "",
    business_name:              formData.get("business_name"),
  };

  const parsed = settingsSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0].message };
  }

  const entries = Object.entries(parsed.data).map(([key, value]) => ({
    key,
    value: String(value),
  }));

  for (const entry of entries) {
    await supabase
      .from("settings")
      .upsert({ key: entry.key, value: entry.value }, { onConflict: "key" });
  }

  revalidatePath("/admin/settings");
  revalidatePath("/admin/dashboard");
  return { success: true };
}
