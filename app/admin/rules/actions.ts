"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

const optionalInt = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : v),
  z.coerce.number().int().min(1).max(100000).nullable()
);

const ruleSchema = z.object({
  name: z.string().trim().min(2, "Nombre requerido").max(100),
  priority: z.coerce.number().int().min(1).max(999),
  enabled: z.boolean(),
  paper_size: z.enum(["any", "carta", "a4", "oficio2", "legal"]),
  color_mode: z.enum(["any", "bw", "color"]),
  duplex: z.enum(["any", "yes", "no"]),
  min_pages: optionalInt,
  max_pages: optionalInt,
  printer_id: z.string().uuid("Seleccione una impresora"),
  tray: z.string().trim().max(100).transform((v) => v || null),
}).refine((r) => r.min_pages === null || r.max_pages === null || r.min_pages <= r.max_pages, {
  message: "El mínimo de páginas no puede ser mayor que el máximo",
});

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, error: "No autorizado" };
  const { data: profile } = await supabase.from("profiles").select("role, is_active").eq("id", user.id).single();
  if (!profile?.is_active || profile.role !== "admin") return { supabase, error: "Se requieren permisos de administrador" };
  return { supabase, error: null };
}

export async function saveRule(id: string | null, formData: FormData) {
  const { supabase, error: authError } = await requireAdmin();
  if (authError) return { success: false, error: authError };

  const parsed = ruleSchema.safeParse({
    name: formData.get("name"),
    priority: formData.get("priority"),
    enabled: formData.get("enabled") === "on",
    paper_size: formData.get("paper_size"),
    color_mode: formData.get("color_mode"),
    duplex: formData.get("duplex"),
    min_pages: formData.get("min_pages"),
    max_pages: formData.get("max_pages"),
    printer_id: formData.get("printer_id"),
    tray: formData.get("tray") ?? "",
  });
  if (!parsed.success) return { success: false, error: parsed.error.errors[0].message };

  const { error } = id
    ? await supabase.from("printer_rules").update(parsed.data).eq("id", id)
    : await supabase.from("printer_rules").insert(parsed.data);
  if (error) return { success: false, error: error.message };

  revalidatePath("/admin/rules");
  return { success: true };
}

export async function toggleRule(id: string, enabled: boolean) {
  const { supabase, error: authError } = await requireAdmin();
  if (authError) return { success: false, error: authError };
  const { error } = await supabase.from("printer_rules").update({ enabled }).eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/rules");
  return { success: true };
}

export async function deleteRule(id: string) {
  const { supabase, error: authError } = await requireAdmin();
  if (authError) return { success: false, error: authError };
  const { error } = await supabase.from("printer_rules").delete().eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/rules");
  return { success: true };
}
