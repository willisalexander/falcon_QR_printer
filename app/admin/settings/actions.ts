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

// Ajustes del flujo local (recepción por carpeta). El agente los lee de esta tabla.
const localSettingsSchema = z.object({
  retention_days:         z.coerce.number().int().min(1, "Mínimo 1 día").max(3650),
  local_max_file_size_mb: z.coerce.number().int().min(1).max(500),
  convert_timeout_sec:    z.coerce.number().int().min(10, "Mínimo 10 segundos").max(900),
  convert_concurrency:    z.coerce.number().int().min(1).max(4),
  paper_tolerance_pt:     z.coerce.number().min(1).max(20),
  file_stability_ms:      z.coerce.number().int().min(500, "Mínimo 500 ms").max(60000),
  printer_wait_min:       z.coerce.number().int().min(1).max(240),
  auto_confirm_spooler:   z.enum(["true", "false"]),
});

export async function updateLocalSettings(formData: FormData) {
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

  const parsed = localSettingsSchema.safeParse(
    Object.fromEntries(Object.keys(localSettingsSchema.shape).map((k) => [k, formData.get(k)]))
  );
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0].message };
  }

  for (const [key, value] of Object.entries(parsed.data)) {
    const { error } = await supabase
      .from("settings")
      .upsert({ key, value: String(value) }, { onConflict: "key" });
    if (error) return { success: false, error: error.message };
  }

  revalidatePath("/admin/settings");
  return { success: true };
}

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
